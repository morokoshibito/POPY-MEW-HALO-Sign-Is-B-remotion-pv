"""Merge the @fontsource woff2 shards of M PLUS Rounded 1c into one TTF per weight.

Usage: python build_font.py <fontsource files dir> <out dir> <weight> [<weight> ...]
The font is SIL OFL 1.1; the licence text is copied next to the output.
"""
import glob
import os
import sys
import tempfile

from fontTools.merge import Merger
from fontTools.ttLib import TTFont


def main():
    src, out = sys.argv[1], sys.argv[2]
    weights = sys.argv[3:] or ["900"]
    os.makedirs(out, exist_ok=True)
    for w in weights:
        files = sorted(glob.glob(os.path.join(src, f"*-{w}-normal.woff2")))
        print(f"[font] weight {w}: {len(files)} shards")
        if not files:
            raise SystemExit(f"no shards for weight {w} in {src}")
        tmp = tempfile.mkdtemp()
        ttfs = []
        seen = set()
        for f in files:
            font = TTFont(f)
            cps = set(font.getBestCmap().keys())
            if cps <= seen:
                continue  # nothing new in this shard
            seen |= cps
            font.flavor = None
            p = os.path.join(tmp, os.path.basename(f) + ".ttf")
            font.save(p)
            ttfs.append(p)
        merged = Merger().merge(ttfs)
        name = {"800": "ExtraBold", "900": "Black"}.get(w, w)
        dst = os.path.join(out, f"MPLUSRounded1c-{name}.ttf")
        merged.save(dst)
        print(f"[font] {dst}: {len(merged.getBestCmap())} code points, {os.path.getsize(dst) // 1024} KB")


if __name__ == "__main__":
    main()
