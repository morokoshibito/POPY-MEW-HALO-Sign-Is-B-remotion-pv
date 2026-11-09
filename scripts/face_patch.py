"""Paste expression face patches onto the original full-body portraits.
usage: face_patch.py <chars_dir> <patch_dir> <out_dir> <debug_dir>
For each <m>_face_<e>.png (made by editing the head crop of <m>_full): register it to the original head
crop (ORB + RANSAC similarity, features outside the face only), take the pixels that changed inside the
face ellipse (eyes, brows, mouth, blush), feather, colour-match, and composite into <m>_full -> <m>_full_<e>.png
"""
import sys, os, json, glob
import numpy as np, cv2
from PIL import Image

chars, pdir, odir, ddir = sys.argv[1:5]
os.makedirs(odir, exist_ok=True); os.makedirs(ddir, exist_ok=True)
crops = json.load(open(os.path.join(chars, 'crops.json')))
GREY = np.array([166, 171, 177], np.float32)

for m in ['popy', 'mew', 'halo']:
    full = np.array(Image.open(os.path.join(chars, f'{m}_full.png')).convert('RGBA')).astype(np.float32)
    H, W = full.shape[:2]
    cx, cy, fh = crops[f'{m}_full']
    fx, fy, f = cx * W, cy * H, fh * H
    side = int(f * 3.0); x0 = int(fx - side / 2); y0 = int(fy - side * 0.45)
    # original head crop on grey, in full-image pixels
    pad = np.zeros((side, side, 4), np.float32)
    sx0, sy0 = max(0, x0), max(0, y0); sx1, sy1 = min(W, x0 + side), min(H, y0 + side)
    pad[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = full[sy0:sy1, sx0:sx1]
    a = pad[..., 3:4] / 255
    orig = pad[..., :3] * a + GREY * (1 - a)
    og = cv2.cvtColor(orig.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    # face ellipse in crop coordinates
    ecx, ecy = fx - x0, fy - y0
    yy, xx = np.mgrid[0:side, 0:side].astype(np.float32)
    ell = ((xx - ecx) / (f * 0.62)) ** 2 + ((yy - (ecy + f * 0.05)) / (f * 0.66)) ** 2
    ell_soft = np.clip((1.0 - ell) / 0.25, 0, 1)  # 1 inside, feathered edge
    outside = (ell > 1.5).astype(np.uint8) * 255
    orb = cv2.ORB_create(6000)
    k1, d1 = orb.detectAndCompute(og, outside)
    for fp in sorted(glob.glob(os.path.join(pdir, '**', f'{m}_face_*.png'), recursive=True)):
        e = os.path.basename(fp)[len(m) + 6:-4]
        patch = np.array(Image.open(fp).convert('RGB').resize((side, side), Image.LANCZOS)).astype(np.float32)
        pg = cv2.cvtColor(patch.astype(np.uint8), cv2.COLOR_RGB2GRAY)
        k2, d2 = orb.detectAndCompute(pg, None)
        mt = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d2, d1), key=lambda x: x.distance)[:1500]
        p2 = np.float32([k2[x.queryIdx].pt for x in mt]); p1 = np.float32([k1[x.trainIdx].pt for x in mt])
        M, inl = cv2.estimateAffinePartial2D(p2, p1, method=cv2.RANSAC, ransacReprojThreshold=2.0)
        s = np.hypot(M[0, 0], M[1, 0]); rot = np.degrees(np.arctan2(M[1, 0], M[0, 0]))
        warped = cv2.warpAffine(patch, M, (side, side), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
        # colour match: per-channel gain from the skin/hair ring around the changed area (inside the ellipse,
        # where the two images should agree)
        diff = np.abs(warped - orig).max(axis=2)
        dsm = cv2.GaussianBlur(diff, (0, 0), 3)
        agree = (dsm < 10) & (ell < 1.0)
        gain = (orig[agree].mean(0) + 1) / (warped[agree].mean(0) + 1) if agree.sum() > 500 else np.ones(3)
        warped = np.clip(warped * gain, 0, 255)
        diff = np.abs(warped - orig).max(axis=2)
        dsm = cv2.GaussianBlur(diff, (0, 0), 2.5)
        chg = np.clip((dsm - 8) / 14, 0, 1)
        k = max(3, int(f * 0.04)) | 1
        chg = cv2.dilate(chg, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        chg = cv2.GaussianBlur(chg, (0, 0), f * 0.02)
        mask = np.clip(chg * 1.6, 0, 1) * ell_soft
        comp = orig * (1 - mask[..., None]) + warped * mask[..., None]
        out = full.copy()
        reg = out[sy0:sy1, sx0:sx1]
        mk = mask[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0, None]
        reg[..., :3] = reg[..., :3] * (1 - mk) + comp[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] * mk
        out[sy0:sy1, sx0:sx1] = reg
        Image.fromarray(out.astype(np.uint8), 'RGBA').save(os.path.join(odir, f'{m}_full_{e}.png'))
        # debug: original | result | mask
        dbg = np.concatenate([orig, comp, np.repeat(mask[..., None] * 255, 3, 2)], 1).astype(np.uint8)
        Image.fromarray(dbg).resize((900, 300)).save(os.path.join(ddir, f'{m}_{e}.png'))
        print(m, e, f'inliers {int(inl.sum())}/{len(mt)} scale {s:.4f} rot {rot:.2f} gain {np.round(gain,3)} mask {mask.mean():.4f}')
