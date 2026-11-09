"""Remove grey background pockets left inside hair (v17, user: HALO's hair edges kept a lot of grey).

The generated portraits stand on a flat grey. The first cut-out (prep_chars.py) treated grey pockets that are
enclosed by hair strands as part of the figure when the matting model said so, and HALO's pale blonde hair is
close enough to the grey that whole pockets survived as opaque grey blocks.

Per image:
 1. Pocket candidates: connected regions of near-neutral grey (distance to the measured pocket grey < DIST,
    saturation < SAT).
 2. A region is background when the ring of pixels around it is mostly hair (pale yellow) or already
    transparent, or when it is a flat patch of the backdrop grey bigger than 150 px (behind a ribbon, between
    strands and a sleeve). Small grey shading inside white or navy fabric is kept.
 3. Those regions become transparent. Around them (a band of BAND px) each pixel is unmixed against the grey:
    alpha = projection of (C - B) on (F - B), F = the local figure colour (normalised convolution of the sure,
    clearly non-grey opaque pixels), and the colour is de-spilled to (C - (1 - alpha) B) / alpha. Alpha only ever goes down.

usage: python fix_grey_pockets.py <in.png> <out.png> [debug.png]
"""
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

DIST = 24
SAT = 0.075
BAND = 7


def hair_like(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = (mx - mn) / np.maximum(mx, 1)
    # pale to golden blonde: red >= green > blue, warm, light
    return (r > 170) & (g > 150) & (r >= g - 4) & (g > b + 12) & (sat > 0.1) & (sat < 0.62)


def fix(src, dst, dbg=None):
    im = np.array(Image.open(src).convert('RGBA')).astype(np.float32)
    rgb = im[..., :3]
    a = im[..., 3] / 255.0
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = (mx - mn) / np.maximum(mx, 1)
    # the pocket grey, measured on the most neutral opaque mid-grey pixels
    cand0 = (a > 0.9) & (sat < 0.04) & (mx > 140) & (mx < 200)
    B = np.median(rgb[cand0], axis=0) if cand0.sum() > 1000 else np.array([174.0, 174.0, 175.0])
    d = np.linalg.norm(rgb - B, axis=2)
    cand = (a > 0) & (d < DIST) & (sat < SAT)
    lab, n = ndimage.label(cand)
    if n == 0:
        Image.fromarray(im.astype(np.uint8), 'RGBA').save(dst)
        return 0
    hair = hair_like(rgb) & (a > 0.9)
    clear = a < 0.1
    good = (hair | clear).astype(np.float32)
    ring_ok = np.zeros(n + 1)
    ring_n = np.zeros(n + 1)
    # ring = dilation minus the region, per component (via label dilation)
    dil = ndimage.grey_dilation(lab, size=(9, 9))
    ring = (dil > 0) & (lab == 0)
    np.add.at(ring_ok, dil[ring], good[ring])
    np.add.at(ring_n, dil[ring], 1)
    frac = ring_ok / np.maximum(ring_n, 1)
    sizes = ndimage.sum(np.ones_like(a), lab, np.arange(n + 1))
    # flat grey patches of some size are the backdrop whatever surrounds them (behind a ribbon, between strands
    # and the sleeve); the costume has no flat neutral grey (its shading is tinted and varies)
    sd = ndimage.standard_deviation(rgb[..., 0], lab, np.arange(n + 1))
    keep_bg = ((frac > 0.55) & (sizes > 12)) | ((sizes > 150) & (sd < 8))
    keep_bg[0] = False
    pocket = keep_bg[lab]
    # band around the pockets: unmix against the grey with the local hair colour
    band = ndimage.binary_dilation(pocket, iterations=BAND) & ~pocket & (a > 0)
    # the sure foreground: opaque and clearly not grey (any hair colour: blonde, brown, pink, blue)
    sure = (a > 0.9) & (d > 45) & ~ndimage.binary_dilation(pocket, iterations=2)
    w = cv2.GaussianBlur(sure.astype(np.float32), (0, 0), 9)
    F = np.stack([cv2.GaussianBlur(rgb[..., c] * sure, (0, 0), 9) for c in range(3)], -1) / np.maximum(w[..., None], 1e-4)
    has = w > 0.02
    FB = F - B
    al = np.clip(((rgb - B) * FB).sum(2) / np.maximum((FB * FB).sum(2), 1.0), 0, 1)
    use = band & has
    a2 = a.copy()
    a2[pocket] = 0
    a2[use] = np.minimum(a[use], al[use])
    rgb2 = rgb.copy()
    k = use & (a2 > 0.02)
    rgb2[k] = np.clip((rgb[k] - (1 - a2[k, None]) * B) / a2[k, None], 0, 255)
    out = np.concatenate([rgb2, (a2 * 255)[..., None]], -1)
    Image.fromarray(out.round().astype(np.uint8), 'RGBA').save(dst)
    if dbg:
        h, wd = a.shape
        bgc = np.array([40, 10, 60], np.float32)
        before = rgb * a[..., None] + bgc * (1 - a[..., None])
        after = rgb2 * a2[..., None] + bgc * (1 - a2[..., None])
        mark = before.copy()
        mark[pocket] = [0, 255, 0]
        mark[use] = mark[use] * 0.5 + np.array([255, 0, 255]) * 0.5
        sc = 900 / max(h, wd)
        tiles = [Image.fromarray(x.astype(np.uint8)).resize((int(wd * sc), int(h * sc))) for x in (before, mark, after)]
        G = Image.new('RGB', (tiles[0].width * 3, tiles[0].height))
        for i, t in enumerate(tiles):
            G.paste(t, (i * tiles[0].width, 0))
        G.save(dbg)
    removed = int(pocket.sum())
    print(f'{src}: grey {np.round(B, 1)}, {int(keep_bg.sum())} pockets, {removed} px cleared, {int(use.sum())} edge px unmixed')
    return removed


if __name__ == '__main__':
    fix(*sys.argv[1:4])
