"""Put a regenerated portrait into the coordinate frame of the one it replaces, so every shot that
draws it keeps the same size and position (the MV sizes a portrait by its picture height).

Usage: python align_portrait.py <old.png> <new.png> <out.png> [--face cx,cy,h]

- Registers new -> old (ORB + RANSAC similarity on the opaque figure, colour-composited on grey).
- The output has the old picture's height, the same scale and vertical placement; the width grows
  symmetrically about the old centre until the whole new figure fits (hands no longer cut).
- Below the old bottom edge the figure is cropped (legs; the MV keeps that edge out of frame).
- Prints the face box of the output as fractions (from the old face box via the transform).
"""
import json
import sys

import cv2
import numpy as np
from PIL import Image


def load(p):
    im = np.asarray(Image.open(p).convert('RGBA')).astype(np.float32)
    a = im[..., 3:4] / 255
    rgb = im[..., :3] * a + 128 * (1 - a)
    return im, rgb.astype(np.uint8), (a[..., 0] > 0.5).astype(np.uint8)


def main():
    old_p, new_p, out_p = sys.argv[1:4]
    face = None
    if '--face' in sys.argv:
        face = [float(v) for v in sys.argv[sys.argv.index('--face') + 1].split(',')]
    old, orgb, omask = load(old_p)
    new, nrgb, nmask = load(new_p)
    oh, ow = orgb.shape[:2]
    nh, nw = nrgb.shape[:2]
    # work at half size
    s = 0.5
    og = cv2.cvtColor(cv2.resize(orgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
    ng = cv2.cvtColor(cv2.resize(nrgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
    om = cv2.resize(omask, None, fx=s, fy=s, interpolation=cv2.INTER_NEAREST)
    nm = cv2.resize(nmask, None, fx=s, fy=s, interpolation=cv2.INTER_NEAREST)
    orb = cv2.ORB_create(6000, fastThreshold=8)
    k1, d1 = orb.detectAndCompute(ng, nm)
    k2, d2 = orb.detectAndCompute(og, om)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    good = []
    for pair in bf.knnMatch(d1, d2, k=2):
        if len(pair) == 2 and pair[0].distance < 0.8 * pair[1].distance:
            good.append(pair[0])
    p1 = np.float32([k1[m.queryIdx].pt for m in good]) / s
    p2 = np.float32([k2[m.trainIdx].pt for m in good]) / s
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=6.0, maxIters=20000, confidence=0.999)
    inl = inl.ravel().astype(bool)
    sc = float(np.hypot(M[0, 0], M[1, 0]))
    rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
    err = np.linalg.norm((p1[inl] @ M[:, :2].T + M[:, 2]) - p2[inl], axis=1)
    print(f'[align] matches {len(good)} inliers {inl.sum()} scale {sc:.4f} rot {rot:.2f}deg median err {np.median(err):.1f}px')
    # drop the rotation (tiny) to keep the picture upright: similarity with scale only
    A = np.array([[sc, 0, M[0, 2]], [0, sc, M[1, 2]]], np.float32)
    # new figure bbox in old coords
    ys, xs = np.where(new[..., 3] > 5)
    x0, x1 = xs.min() * sc + A[0, 2], xs.max() * sc + A[0, 2]
    y0 = ys.min() * sc + A[1, 2]
    cx = ow / 2
    half = max(cx - x0, x1 - cx, ow / 2) + 12
    pad = int(np.ceil(half - ow / 2))
    top = int(np.ceil(max(0, -y0) + (12 if y0 < 0 else 0)))
    OW, OH = ow + 2 * pad, oh + top
    A2 = A.copy()
    A2[0, 2] += pad
    A2[1, 2] += top
    warped = cv2.warpAffine(new, A2, (OW, OH), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    warped = np.clip(warped, 0, 255).astype(np.uint8)
    Image.fromarray(warped, 'RGBA').save(out_p, optimize=True)
    res = {'size': [OW, OH], 'pad_x': pad, 'pad_top': top, 'scale': sc}
    if face:
        fx, fy, fh = face
        res['face'] = [round((fx * ow + pad) / OW, 4), round((fy * oh + top) / OH, 4), round(fh * oh / OH, 4)]
    print('[align]', json.dumps(res))


if __name__ == '__main__':
    main()
