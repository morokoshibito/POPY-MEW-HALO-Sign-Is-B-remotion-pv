"""Tile PNG stills into one contact sheet with their timecodes.
Usage: python grid.py <dir> <out.png> [cols] [ref.mp4]
With ref.mp4, each still is paired with the reference frame at the same second (internal check only).
"""
import glob
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
ref = sys.argv[4] if len(sys.argv) > 4 else None
files = sorted(glob.glob(os.path.join(d, "t*.png")))
tw = 480
tiles = []
for f in files:
    sec = float(os.path.basename(f)[1:-4])
    im = Image.open(f).convert("RGB")
    im = im.resize((tw, int(im.height * tw / im.width)))
    if ref:
        tmp = tempfile.mktemp(suffix=".png")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{sec:.3f}", "-i", ref, "-frames:v", "1", "-vf", f"scale={tw}:-1", tmp, "-y"], check=True)
        r = Image.open(tmp).convert("RGB")
        pair = Image.new("RGB", (tw * 2 + 6, im.height), "white")
        pair.paste(r, (0, 0))
        pair.paste(im, (tw + 6, 0))
        im = pair
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 92, 22], fill=(0, 0, 0))
    dr.text((4, 4), f"{sec:7.2f}s", fill=(255, 255, 0))
    tiles.append(im)
if not tiles:
    raise SystemExit("no stills")
w, h = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + (cols - 1) * 4, rows * h + (rows - 1) * 4), (40, 40, 40))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
sheet.save(out)
print(out, sheet.size)
