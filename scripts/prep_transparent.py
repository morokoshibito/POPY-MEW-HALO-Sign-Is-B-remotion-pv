"""Build the MV character pictures from transparent-background portraits (v18).

usage:
  python prep_transparent.py <trans_dir> <out_dir> <models_dir> <full_patch_dir> [work_dir]

trans_dir       transparent PNGs: popy_full, popy_main, popy_laugh, popy_wink, popy_kiss, mew_full, mew_main,
                mew_laugh, mew_wink, halo_full, halo_main, halo_laugh, halo_wink, halo_kiss
out_dir         public/chars (its crops.json is read for the old face positions and rewritten)
models_dir      esrgan_av3.onnx
full_patch_dir  the expression face patches for the full-body pictures (<m>_face_<e>.png)

What it does:
 0. A grey rim of the backdrop left opaque along the outline is trimmed (trim_grey_rim).
 1. Anime upscale (2x, or whatever keeps the face as large as in the old picture) (Real-ESRGAN animevideov3) of the colour and, separately, of the alpha channel.
    The background removal kept the original colour in the soft edge pixels (mixed with the grey the
    picture was generated on), so the edge colour is un-mixed: F = (C - (1 - a) B) / a, and the faintest
    edge pixels take the colour of the nearest solid pixel. No grey fringe is left on hair strands.
 2. Thigh-up pictures: one picture per member is the body for all its expressions (POPY kiss, MEW laugh,
    HALO laugh). The other expressions are made by pasting only the changed face pixels (eyes, brows,
    mouth, blush) of that expression onto the body, as for the full-body pictures. All expressions of a
    member then share one canvas and swap without any jump in hair, hands or outline.
 3. Full-body pictures: replaced by the transparent ones; the expression variants are rebuilt with
    face_patch.py from the same face patches as before.
 4. Every new picture is placed on the canvas of the old one with its face exactly where the old face was
    (feature registration), so every shot frames it as before and crops.json keeps its numbers. All
    expressions of a thigh-up member use the canvas and face position of that member's body picture.
"""
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from esrgan_onnx import run as esrgan_run  # noqa: E402
from prep_chars import fade_frame_cuts  # noqa: E402

GREY = np.array([166, 171, 177], np.float32)  # what face_patch.py composites on
MAIN_GROUPS = {  # member: (body picture, {output kind: face source picture})
    'popy': ('popy_kiss', {'main': 'popy_main', 'laugh': 'popy_laugh', 'wink': 'popy_wink', 'kiss': None}),
    'mew': ('mew_laugh', {'main': 'mew_main', 'laugh': None, 'wink': 'mew_wink'}),
    'halo': ('halo_laugh', {'main': 'halo_main', 'laugh': None, 'wink': 'halo_wink', 'kiss': 'halo_kiss'}),
}


def load_rgba(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)


def edge_bg(rgba):
    """The grey the picture was generated on, read from the faintest edge pixels (they are almost pure
    background)."""
    a = rgba[..., 3] / 255
    m = (a > 0.01) & (a < 0.08)
    if m.sum() < 200:
        return GREY.copy()
    return np.median(rgba[..., :3][m], axis=0)


def upscale(trans, name, work, model, scale=2.0):
    """Upscaled colour (picture on its own grey, as generated) and 2x alpha, cached in work/."""
    rgba = load_rgba(os.path.join(trans, f'{name}.png'))
    bg = edge_bg(rgba)
    a = rgba[..., 3:4] / 255
    rgb = np.where(a > 0, rgba[..., :3], bg)  # transparent pixels carry black; restore the grey
    pc, pa = os.path.join(work, f'{name}_rgb_x{scale:g}.png'), os.path.join(work, f'{name}_a_x{scale:g}.png')
    if not os.path.exists(pc):
        src = os.path.join(work, f'{name}_rgb.png')
        Image.fromarray(rgb.astype(np.uint8)).save(src)
        esrgan_run(model, src, pc, scale)
    if not os.path.exists(pa):
        src = os.path.join(work, f'{name}_a.png')
        Image.fromarray(np.repeat(rgba[..., 3:4], 3, 2).astype(np.uint8)).save(src)
        esrgan_run(model, src, pa, scale)
    C = np.asarray(Image.open(pc).convert('RGB')).astype(np.float32)
    A = np.asarray(Image.open(pa).convert('RGB')).astype(np.float32).mean(2) / 255
    A = np.clip((A - 0.02) / 0.96, 0, 1)
    return C, A, bg


def clear_pockets(C, A, bg, min_px=150):
    """Flat patches of the exact backdrop grey kept opaque inside the figure (POPY full: between the arm and
    the bow) become transparent."""
    g = (A > 0.5) & (np.abs(C - bg).max(2) < 12)
    lab, n = ndimage.label(g)
    A2 = A.copy()
    cleared = 0
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        m = lab[sl] == i
        if m.sum() < min_px or C[sl][m].std(0).max() > 6:
            continue
        A2[sl][m] = 0
        cleared += int(m.sum())
    print(f'  grey pockets cleared: {cleared} px')
    return A2


def trim_grey_rim(C, A, bg, band=5):
    """Some cut-outs (POPY full) keep a 1-2 px rim of the grey backdrop as opaque. Near the outline, alpha
    is limited to what the colour says: a = projection of (C - B) on (F - B), F = the nearest clearly
    non-grey figure colour. Alpha only goes down; pixels with no reliable F keep their alpha."""
    out_ = A < 0.05
    edge = ndimage.binary_dilation(out_, iterations=band) & ~out_
    sure = (A >= 0.9) & (np.linalg.norm(C - bg, axis=2) > 40)
    _, (iy, ix) = ndimage.distance_transform_edt(~sure, return_indices=True)
    F = C[iy, ix]
    fb = F - bg
    n2 = (fb ** 2).sum(2)
    ac = np.clip(((C - bg) * fb).sum(2) / np.maximum(n2, 1), 0, 1)
    ok = edge & (n2 > 30 ** 2)
    A2 = A.copy()
    A2[ok] = np.minimum(A[ok], np.clip((ac[ok] - 0.08) / 0.84, 0, 1))
    print(f'  grey rim trimmed: {int(((A - A2) > 0.3).sum())} px')
    return A2


def unmix(C, A, bg):
    """Straight (un-premultiplied) edge colour without the grey."""
    a = A[..., None]
    F = np.clip((C - (1 - a) * bg) / np.maximum(a, 1e-3), 0, 255)
    solid = A >= 0.6
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    near = C[iy, ix]
    w = np.clip((A - 0.1) / 0.5, 0, 1)[..., None]
    F = np.where(solid[..., None], C, w * F + (1 - w) * near)
    return F


def register(src_gray, dst_gray, mask=None):
    """Similarity transform mapping src pixels to dst pixels (ORB + RANSAC)."""
    orb = cv2.ORB_create(8000)
    k1, d1 = orb.detectAndCompute(src_gray, None)
    k2, d2 = orb.detectAndCompute(dst_gray, mask)
    mt = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2), key=lambda x: x.distance)[:2000]
    p1 = np.float32([k1[x.queryIdx].pt for x in mt])
    p2 = np.float32([k2[x.trainIdx].pt for x in mt])
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    return M, int(inl.sum()), len(mt)


def on_grey(rgb, A):
    a = A[..., None]
    return rgb * a + GREY * (1 - a)


def gray8(x):
    return cv2.cvtColor(np.clip(x, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)


def old_face_in(new_rgb, new_A, old_png, old_face):
    """Face box of the old picture, carried into the new picture's pixel space."""
    old = load_rgba(old_png)
    oh, ow = old.shape[:2]
    og = gray8(on_grey(old[..., :3], old[..., 3] / 255))
    ng = gray8(on_grey(new_rgb, new_A))
    M, n, tot = register(og, ng)
    cx, cy, fh = old_face
    p = M @ np.array([cx * ow, cy * oh, 1.0])
    s = float(np.hypot(M[0, 0], M[1, 0]))
    print(f'  face from {os.path.basename(old_png)}: inliers {n}/{tot} scale {s:.4f}')
    return (p[0], p[1], fh * oh * s), s


def paste_face(base_rgb, base_A, src_rgb, face, label, dbg_dir):
    """face_patch.py's method for two pictures of the same size: register the source head to the body
    head on the hair and outline outside the face, paste only the changed pixels inside the face."""
    fx, fy, f = face
    H, W = base_A.shape
    side = int(f * 3.0)
    x0, y0 = int(fx - side / 2), int(fy - side * 0.45)
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(W, x0 + side), min(H, y0 + side)

    def crop(img):
        out = np.tile(GREY, (side, side, 1)).astype(np.float32)
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = img[sy0:sy1, sx0:sx1]
        return out

    orig = crop(on_grey(base_rgb, base_A))
    patch = crop(src_rgb)
    ecx, ecy = fx - x0, fy - y0
    yy, xx = np.mgrid[0:side, 0:side].astype(np.float32)
    ell = ((xx - ecx) / (f * 0.62)) ** 2 + ((yy - (ecy + f * 0.05)) / (f * 0.66)) ** 2
    ell_soft = np.clip((1.0 - ell) / 0.25, 0, 1)
    outside = (ell > 1.5).astype(np.uint8) * 255
    M, n, tot = register(gray8(patch), gray8(orig), outside)
    s, rot = np.hypot(M[0, 0], M[1, 0]), np.degrees(np.arctan2(M[1, 0], M[0, 0]))
    warped = cv2.warpAffine(patch, M, (side, side), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    diff = np.abs(warped - orig).max(axis=2)
    agree = (cv2.GaussianBlur(diff, (0, 0), 3) < 10) & (ell < 1.0)
    gain = (orig[agree].mean(0) + 1) / (warped[agree].mean(0) + 1) if agree.sum() > 500 else np.ones(3)
    warped = np.clip(warped * gain, 0, 255)
    diff = np.abs(warped - orig).max(axis=2)
    chg = np.clip((cv2.GaussianBlur(diff, (0, 0), 2.5) - 8) / 14, 0, 1)
    k = max(3, int(f * 0.04)) | 1
    chg = cv2.dilate(chg, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    chg = cv2.GaussianBlur(chg, (0, 0), f * 0.02)
    mask = np.clip(chg * 1.6, 0, 1) * ell_soft
    mk = mask[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0, None]
    out = base_rgb.copy()
    out[sy0:sy1, sx0:sx1] = out[sy0:sy1, sx0:sx1] * (1 - mk) + warped[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] * mk
    comp = orig * (1 - mask[..., None]) + warped * mask[..., None]
    dbg = np.concatenate([orig, comp, np.repeat(mask[..., None] * 255, 3, 2)], 1).astype(np.uint8)
    Image.fromarray(dbg).resize((1200, 400)).save(os.path.join(dbg_dir, f'main_{label}.png'))
    print(f'  {label}: inliers {n}/{tot} scale {s:.4f} rot {rot:.2f} gain {np.round(gain, 3)} mask {mask.mean():.4f}')
    return out


def reframe(old_png, old_face, face):
    """Canvas of the old picture, with the new face where the old face was: shots that place a picture by
    its outline (figure/bust) frame it exactly as before, and crops.json keeps its numbers."""
    ow, oh = Image.open(old_png).size
    ox, oy = old_face[0] * ow, old_face[1] * oh
    return int(round(ox - face[0])), int(round(oy - face[1])), ow, oh


def place(rgb, A, frame):
    """Paste into the old canvas; returns the canvas and how much of the figure fell outside it."""
    dx, dy, ow, oh = frame
    H, W = A.shape
    out = np.zeros((oh, ow, 4), np.float32)
    x0, y0 = max(0, dx), max(0, dy)
    x1, y1 = min(ow, dx + W), min(oh, dy + H)
    out[y0:y1, x0:x1, :3] = rgb[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    out[y0:y1, x0:x1, 3] = A[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    lost = float((A > 0.5).sum() - (out[..., 3] > 0.5).sum())
    out[..., 3] = fade_frame_cuts(out[..., 3])
    return out, lost


def save_canvas(out, path):
    rgba = np.dstack([np.clip(out[..., :3], 0, 255), out[..., 3:] * 255]) + 0.5
    Image.fromarray(rgba.astype(np.uint8), 'RGBA').save(path, optimize=True)


def crop_box(A, pad=8):
    ys, xs = np.where(A > 0.02)
    return max(0, ys.min() - pad), min(A.shape[0], ys.max() + pad + 1), max(0, xs.min() - pad), min(A.shape[1], xs.max() + pad + 1)


def save(rgb, A, box, path):
    y0, y1, x0, x1 = box
    rgba = np.dstack([np.clip(rgb, 0, 255) + 0.5, A * 255 + 0.5])[y0:y1, x0:x1].astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(path, optimize=True)


def face_frac(face, box):
    y0, y1, x0, x1 = box
    fx, fy, f = face
    return [round((fx - x0) / (x1 - x0), 4), round((fy - y0) / (y1 - y0), 4), round(f / (y1 - y0), 4)]


def main():
    trans, out, models, fpatch = sys.argv[1:5]
    work = sys.argv[5] if len(sys.argv) > 5 else os.path.join(trans, '_work')
    dbg = os.path.join(work, 'debug')
    os.makedirs(dbg, exist_ok=True)
    model = os.path.join(models, 'esrgan_av3.onnx')
    crops_path = os.path.join(out, 'crops.json')
    crops = json.load(open(crops_path))

    # ---- thigh-up pictures
    for m, (body, kinds) in MAIN_GROUPS.items():
        print(f'[main] {m}: body {body}')
        scale = 2.0
        while True:  # keep the face as many pixels high as in the old picture (close-ups stay sharp)
            C, A, bg = upscale(trans, body, work, model, scale)
            A = trim_grey_rim(C, clear_pockets(C, A, bg), bg)
            F = unmix(C, A, bg)
            face, s = old_face_in(F, A, os.path.join(out, f'{body}.png'), crops[body])
            if abs(s - 1) < 0.03:
                break
            scale = round(scale / s, 2)
            print(f'  face size differs from the old picture -> upscale x{scale:g}')
        print(f'  grey {bg.round(0)}')
        frame = reframe(os.path.join(out, f'{body}.png'), crops[body], face)
        body_face = list(crops[body])
        for kind, src in kinds.items():
            if src is None:
                rgb = F
            else:
                Cs, _, _ = upscale(trans, src, work, model, scale)
                rgb = paste_face(F, A, Cs, face, f'{m}_{kind}', dbg)
            canvas, lost = place(rgb, A, frame)
            save_canvas(canvas, os.path.join(out, f'{m}_{kind}.png'))
            crops[f'{m}_{kind}'] = body_face
        print(f'  canvas {frame[2]}x{frame[3]} (old {body}) offset {frame[:2]} figure px outside {lost:.0f} face {body_face}')

    # ---- full-body pictures
    for m in ('popy', 'mew', 'halo'):
        name = f'{m}_full'
        print(f'[full] {name}')
        C, A, bg = upscale(trans, name, work, model)
        print(f'  grey {bg.round(0)}')
        A = trim_grey_rim(C, clear_pockets(C, A, bg), bg)
        F = unmix(C, A, bg)
        face, _ = old_face_in(F, A, os.path.join(out, f'{name}.png'), crops[name])
        frame = reframe(os.path.join(out, f'{name}.png'), crops[name], face)
        canvas, lost = place(F, A, frame)
        save_canvas(canvas, os.path.join(out, f'{name}.png'))
        print(f'  canvas {frame[2]}x{frame[3]} offset {frame[:2]} figure px outside {lost:.0f} face {crops[name]}')
    json.dump(crops, open(crops_path, 'w'), indent=1)

    # ---- full-body expressions: same face patches as before, on the new full-body pictures
    subprocess.run([sys.executable, os.path.join(HERE, 'face_patch.py'), out, fpatch, out, dbg], check=True)
    print('[done]')


if __name__ == '__main__':
    main()
