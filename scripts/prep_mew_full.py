"""Replace MEW's full-body picture with a newly drawn one and rebuild its expression variants (v20).

usage:
  python prep_mew_full.py <new_full.png> <heads_dir> <chars_dir> <models_dir> <work_dir>

new_full.png  the new transparent full-body picture (any size; background removed by the user)
heads_dir     mew_head_base.png (the head close-up cut from new_full: crop box HEAD_BOX, resized to a square)
              and mew_head_<e>.png for e in laugh, wink, kiss, soft, smug (expression edits of that close-up)
chars_dir     public/chars: mew_full*.png are written, crops.json keeps mew_full's numbers

What it does:
 1. The background remover left the edge pixels white (alpha < 0.8 is ~90 % pure white). Every pixel's
    colour is replaced by the colour of the nearest solid pixel (alpha >= 0.8) before upscaling, so no
    white fringe can survive on hair strands. Colour and alpha are upscaled separately (Real-ESRGAN).
 2. The new drawing is placed on the canvas of the old mew_full with its face where the old face was and
    the same face size, measured by registering the old head on the new head (features on the head only):
    every shot frames MEW exactly as before and crops.json keeps its numbers.
 3. Expressions: each edited close-up is put back where its crop came from (known crop box), then
    registered again on the hair and outline outside the face (the edits shift edges by a few pixels),
    and only the pixels that changed inside the face ellipse are pasted (prep_transparent.paste_face).
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from esrgan_onnx import run as esrgan_run  # noqa: E402
from prep_chars import fade_frame_cuts  # noqa: E402
from prep_transparent import gray8, on_grey, paste_face, save_canvas  # noqa: E402

HEAD_BOX = (235, -20, 470)  # x0, y0, side of the close-up crop in new_full pixels
EXPR = ('laugh', 'wink', 'kiss', 'soft', 'smug')


def load(path):
    rgba = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    a = rgba[..., 3] / max(1.0, rgba[..., 3].max())  # this remover tops out at 253
    return rgba[..., :3], a


def bleed(rgb, a, solid=0.8):
    """Colour of the nearest solid pixel everywhere outside the solid area."""
    s = a >= solid
    _, (iy, ix) = ndimage.distance_transform_edt(~s, return_indices=True)
    return np.where(s[..., None], rgb, rgb[iy, ix])


def upscale(rgb, a, work, model, scale):
    pc, pa = os.path.join(work, f'full_rgb_x{scale:g}.png'), os.path.join(work, f'full_a_x{scale:g}.png')
    if not os.path.exists(pc):
        Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(os.path.join(work, 'full_rgb.png'))
        esrgan_run(model, os.path.join(work, 'full_rgb.png'), pc, scale)
    if not os.path.exists(pa):
        Image.fromarray(np.repeat((a * 255)[..., None], 3, 2).astype(np.uint8)).save(os.path.join(work, 'full_a.png'))
        esrgan_run(model, os.path.join(work, 'full_a.png'), pa, scale)
    C = np.asarray(Image.open(pc).convert('RGB')).astype(np.float32)
    A = np.asarray(Image.open(pa).convert('RGB')).astype(np.float32).mean(2) / 255
    return C, np.clip((A - 0.06) / 0.92, 0, 1)


def head_register(old_rgb, old_a, old_face, new_rgb, new_a):
    """Similarity mapping old pixels to new pixels, from features on the head of both pictures."""
    oh, ow = old_a.shape
    cx, cy, fh = old_face[0] * ow, old_face[1] * oh, old_face[2] * oh
    om = np.zeros((oh, ow), np.uint8)
    cv2.circle(om, (int(cx), int(cy)), int(fh * 1.3), 255, -1)
    og, ng = gray8(on_grey(old_rgb, old_a)), gray8(on_grey(new_rgb, new_a))
    orb = cv2.ORB_create(6000)
    k1, d1 = orb.detectAndCompute(og, om)
    k2, d2 = orb.detectAndCompute(ng, None)
    mt = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2), key=lambda x: x.distance)[:1500]
    p1 = np.float32([k1[x.queryIdx].pt for x in mt])
    p2 = np.float32([k2[x.trainIdx].pt for x in mt])
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    return M, int(inl.sum()), len(mt), (cx, cy, fh)


def place(rgb, A, frame):
    """prep_transparent.place, with a short fade at the bottom: the new picture's soles touch its lower edge,
    and the usual 4.5 % fade would dissolve the whole sole."""
    dx, dy, ow, oh = frame
    H, W = A.shape
    out = np.zeros((oh, ow, 4), np.float32)
    x0, y0 = max(0, dx), max(0, dy)
    x1, y1 = min(ow, dx + W), min(oh, dy + H)
    out[y0:y1, x0:x1, :3] = rgb[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    out[y0:y1, x0:x1, 3] = A[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    lost = float((A > 0.5).sum() - (out[..., 3] > 0.5).sum())
    out[..., 3] = fade_frame_cuts(out[..., 3], frac=0.012)
    return out, lost


def main():
    new_full, heads, chars, models, work = sys.argv[1:6]
    dbg = os.path.join(work, 'debug')
    os.makedirs(dbg, exist_ok=True)
    model = os.path.join(models, 'esrgan_av3.onnx')
    crops = json.load(open(os.path.join(chars, 'crops.json')))
    old_path = os.path.join(work, 'mew_full_old.png')
    if not os.path.exists(old_path):  # keep the picture the face position was measured on
        Image.open(os.path.join(chars, 'mew_full.png')).save(old_path)
    old = np.asarray(Image.open(old_path).convert('RGBA')).astype(np.float32)
    old_rgb, old_a = old[..., :3], old[..., 3] / 255
    face = crops['mew_full']

    rgb0, a0 = load(new_full)
    rgb0 = bleed(rgb0, a0)
    scale = 2.0
    while True:  # keep the face as many pixels high as in the old picture
        C, A = upscale(rgb0, a0, work, model, scale)
        M, n, tot, (ocx, ocy, ofh) = head_register(old_rgb, old_a, face, C, A)
        s = float(np.hypot(M[0, 0], M[1, 0]))
        rot = np.degrees(np.arctan2(M[1, 0], M[0, 0]))
        print(f'[full] x{scale:g}: head inliers {n}/{tot} scale {s:.4f} rot {rot:.2f}')
        if abs(s - 1) < 0.03:
            break
        scale = round(scale / s, 2)
    nf = M @ np.array([ocx, ocy, 1.0])  # old face centre in the new picture
    oh, ow = old_a.shape
    frame = (int(round(ocx - nf[0])), int(round(ocy - nf[1])), ow, oh)
    canvas, lost = place(C, A, frame)
    save_canvas(canvas, os.path.join(chars, 'mew_full.png'))
    print(f'  canvas {ow}x{oh} offset {frame[:2]} figure px outside {lost:.0f} face {face}')

    # ---- expressions
    base = np.dstack([canvas[..., :3], canvas[..., 3]])
    bA = canvas[..., 3]
    x0, y0, side = HEAD_BOX
    k = scale  # head-crop pixel (in new_full) -> canvas pixel: * k + frame offset
    for e in EXPR:
        hp = os.path.join(heads, f'mew_head_{e}.png')
        h = np.asarray(Image.open(hp).convert('RGBA')).astype(np.float32)
        hs = h.shape[0]
        # put the close-up back where it was cut from, on the base picture (outside the close-up: base)
        f = side / hs * k
        Mh = np.float32([[f, 0, x0 * k + frame[0]], [0, f, y0 * k + frame[1]]])
        hrgb = cv2.warpAffine(h[..., :3], Mh, (ow, oh), flags=cv2.INTER_LANCZOS4, borderValue=0)
        ha = cv2.warpAffine(h[..., 3] / 255, Mh, (ow, oh), flags=cv2.INTER_LINEAR, borderValue=0)
        inside = cv2.warpAffine(np.ones((hs, hs), np.float32), Mh, (ow, oh), flags=cv2.INTER_NEAREST) > 0.5
        src = on_grey(hrgb, ha)
        src = np.where(inside[..., None], src, on_grey(base[..., :3], bA))
        fpx = (face[0] * ow, face[1] * oh, face[2] * oh)
        out = paste_face(base[..., :3], bA, src, fpx, f'mew_full_{e}', dbg)
        save_canvas(np.dstack([out, bA]), os.path.join(chars, f'mew_full_{e}.png'))
    print('[done]')


if __name__ == '__main__':
    main()
