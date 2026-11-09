"""Turn the generated portraits (flat grey background) into MV-ready transparent PNGs.

Usage:
  python prep_chars.py <in_dir> <out_dir> <models_dir> [scale=2]

in_dir     folder containing popy_main.png, mew_full.png, ... (searched recursively)
out_dir    public/chars of the project
models_dir esrgan_av3.onnx, isnet-anime.onnx, lbpcascade_animeface.xml

Steps per image:
 1. 4x anime upscale (Real-ESRGAN animevideov3, ONNX) then Lanczos down to `scale`.
 2. Background key: the grey is measured on the image border; pixels close to it and connected
    to the border are background. Enclosed grey pockets (between an arm and the body) are
    background when the anime matting model agrees.
 3. Soft edge: alpha from colour distance in a thin band, colour de-spill against the grey.
 4. Where the figure is cut by the picture frame (legs at the bottom of a knee-up shot,
    hands at the sides) the alpha fades out, so no hard straight edge shows in the MV.
 5. Crop to the figure, write <name>.png and the face box into crops.json.
"""
import glob
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from esrgan_onnx import run as esrgan_run  # noqa: E402

NAMES = [f"{m}_{k}" for m in ("popy", "mew", "halo") for k in ("main", "full", "laugh", "wink", "kiss")]


def isnet_mask(sess, rgb):
    h, w, _ = rgb.shape
    x = cv2.resize(rgb, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = (x - 0.5) / 1.0
    x = x.transpose(2, 0, 1)[None]
    y = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    y = (y - y.min()) / max(1e-6, y.max() - y.min())
    return cv2.resize(y, (w, h), interpolation=cv2.INTER_LINEAR)


def matte(rgb, guide):
    h, w, _ = rgb.shape
    f = rgb.astype(np.float32)
    border = np.concatenate([f[:4].reshape(-1, 3), f[-4:].reshape(-1, 3), f[:, :4].reshape(-1, 3), f[:, -4:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    # local background: the grey can drift slightly across the image -> smooth estimate from bg pixels
    d = np.linalg.norm(f - bg, axis=2)
    near = d < 14
    lab, n = ndimage.label(near)
    touch = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bgmask = np.isin(lab, list(touch))
    # enclosed grey pockets
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(n + 1))
    guide_mean = ndimage.mean(guide, lab, index=np.arange(n + 1))
    strict = d < 8
    for i in range(1, n + 1):
        if i in touch or sizes[i] < 400:
            continue
        if guide_mean[i] < 0.25 and strict[lab == i].mean() > 0.6:
            bgmask |= lab == i
    bgmask = ndimage.binary_opening(bgmask, iterations=1)
    # alpha: solid inside, distance-based in a thin band around the background
    band = ndimage.binary_dilation(bgmask, iterations=3) & ~ndimage.binary_erosion(bgmask, iterations=2)
    a = np.where(bgmask, 0.0, 1.0)
    soft = np.clip((d - 6.0) / (40.0 - 6.0), 0, 1)
    a = np.where(band, soft, a)
    a = np.where(bgmask & ~band, 0.0, a)
    # despill: remove the grey that is mixed into edge pixels
    am = np.clip(a, 1e-3, 1)[..., None]
    col = np.where(((a > 0) & (a < 1))[..., None], (f - (1 - am) * bg) / am, f)
    col = np.clip(col, 0, 255)
    return col.astype(np.uint8), a.astype(np.float32), bg


def fade_frame_cuts(a, frac=0.045, sides=("bottom",)):
    """Fade alpha toward the picture edges in `sides` where the figure is cut.
    Only the bottom by default: a cut at the bottom (legs of a knee-up shot) always sits below the
    frame or under other layers in the MV. Hands and hair cut at the sides or the top stay hard;
    the MV keeps those edges outside the frame instead of fading them."""
    h, w = a.shape
    out = a.copy()
    n = int(round(min(h, w) * frac))
    ramp = np.linspace(0, 1, n, dtype=np.float32) ** 1.4
    if "bottom" in sides and a[-2:].mean() > 0.02:
        out[-n:] *= ramp[::-1, None]
    if "top" in sides and a[:2].mean() > 0.02:
        out[:n] *= ramp[:, None]
    if "left" in sides and a[:, :2].mean() > 0.02:
        out[:, :n] *= ramp[None, :]
    if "right" in sides and a[:, -2:].mean() > 0.02:
        out[:, -n:] *= ramp[None, ::-1]
    return out


def drop_specks(a, reach=8):
    """Keep the figure (largest opaque component) and whatever touches it; clear isolated specks of
    background noise that passed the key (they would widen the crop and show as dots)."""
    lab, n = ndimage.label(a > 0.02)
    if n <= 1:
        return a
    sizes = ndimage.sum(np.ones_like(a), lab, index=np.arange(1, n + 1))
    main = lab == (int(np.argmax(sizes)) + 1)
    near = ndimage.binary_dilation(main, iterations=reach)
    keep_ids = np.unique(lab[near & (lab > 0)])
    keep = np.isin(lab, keep_ids)
    return np.where(keep, a, 0.0).astype(np.float32)


def face_box(rgb, cascade, kind):
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    g = cv2.equalizeHist(g)
    h, w = g.shape
    faces = cascade.detectMultiScale(g, scaleFactor=1.05, minNeighbors=4, minSize=(int(w * 0.08), int(w * 0.08)))
    if len(faces) == 0:
        return None
    # the face is the biggest detection in the upper part of the picture
    faces = [f for f in faces if f[1] < h * 0.5] or list(faces)
    x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    return [(x + fw / 2) / w, (y + fh / 2) / h, fh / h]


def main():
    src, dst, models = sys.argv[1], sys.argv[2], sys.argv[3]
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
    import onnxruntime as ort

    os.makedirs(dst, exist_ok=True)
    cache = os.path.join(src, "_upscaled")
    os.makedirs(cache, exist_ok=True)
    isnet = ort.InferenceSession(os.path.join(models, "isnet-anime.onnx"), providers=["CPUExecutionProvider"])
    cascade = cv2.CascadeClassifier(os.path.join(models, "lbpcascade_animeface.xml"))
    crops_path = os.path.join(dst, "crops.json")
    crops = json.load(open(crops_path)) if os.path.exists(crops_path) else {}
    found = {os.path.splitext(os.path.basename(p))[0].lower(): p for p in glob.glob(os.path.join(src, "**", "*.png"), recursive=True) if "_upscaled" not in p}
    todo = [n for n in NAMES if n in found]
    print(f"[prep] {len(todo)} images: {todo}")
    for name in todo:
        up = os.path.join(cache, f"{name}_x{scale:g}.png")
        if not os.path.exists(up):
            esrgan_run(os.path.join(models, "esrgan_av3.onnx"), found[name], up, scale)
        rgb = np.asarray(Image.open(up).convert("RGB"))
        guide = isnet_mask(isnet, rgb)
        col, a, bg = matte(rgb, guide)
        a = drop_specks(a)
        a = fade_frame_cuts(a)
        ys, xs = np.where(a > 0.02)
        pad = 8
        y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
        x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
        rgba = np.dstack([col, (a * 255 + 0.5).astype(np.uint8)])[y0:y1, x0:x1]
        Image.fromarray(rgba, "RGBA").save(os.path.join(dst, f"{name}.png"), optimize=True)
        fb = face_box(rgb[y0:y1, x0:x1], cascade, name.split("_")[1])
        if fb and name not in crops:
            crops[name] = [round(v, 4) for v in fb]
        print(f"[prep] {name}: bg {bg.round(0)} crop {x1 - x0}x{y1 - y0} face {crops.get(name)}")
    json.dump(crops, open(crops_path, "w"), indent=1)
    print(f"[prep] wrote {crops_path}")


if __name__ == "__main__":
    main()
