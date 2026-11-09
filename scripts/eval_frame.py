"""Composition self-check from the probe log (node scripts/check.mjs probe <out.jsonl> t0 t1 dt).

usage: python scripts/eval_frame.py <probe.jsonl> [more.jsonl ...]

Per shot it reports (counted in probe frames, 0.1 s each by default):
  FACE-HIDDEN   a visible face (colour figure, face >= 40 px) is covered >= 1/3 by a figure drawn in front
  TEXT-ON-FACE  a lyric glyph sits on a face (glyph centre within 0.35 face heights + half the glyph)
  TEXT-OVERLAP  two glyphs overlap by more than 30 % of the smaller one (letters running into each other)
  FACE-OUT      a face of a colour figure is cut by the frame edge for long (more than half outside)
A finding is reported when it lasts at least 3 probe frames (0.3 s) inside one shot.
"""
import json
import sys
from collections import defaultdict

W, H = 1920, 1080


def frames(paths):
    for p in paths:
        for ln in open(p, encoding='utf-8'):
            ln = ln.strip()
            if ln.startswith('{'):
                yield json.loads(ln)


def main():
    hits = defaultdict(lambda: defaultdict(list))
    order = []
    seen = set()
    for f in frames(sys.argv[1:]):
        shot = ' + '.join(f['shots'])
        if shot not in seen:
            seen.add(shot)
            order.append(shot)
        T = f['T']
        faces = [fg for fg in f['figs'] if fg.get('look') == 'color' and fg.get('al', 1) > 0.5 and fg['face'][2] >= 40]
        for b, fr, frac in f.get('occl', []):
            if frac >= 0.33:
                hits[shot][f'FACE-HIDDEN {b} behind {fr}'].append(T)
        gs = [g for g in f['gs'] if g[4] > 0.5]
        for fg in faces:
            cx, cy, h = fg['face']
            if -h < cx < W + h and -h < cy < H + h:
                for ch, x, y, size, a in gs:
                    if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 < 0.35 * h + 0.35 * size:
                        hits[shot][f'TEXT-ON-FACE {fg["m"]}'].append(T)
                        break
                inside = (min(cx + h / 2, W) - max(cx - h / 2, 0)) * (min(cy + h / 2, H) - max(cy - h / 2, 0)) / (h * h)
                if inside < 0.5 and inside > 0:
                    hits[shot][f'FACE-OUT {fg["m"]}'].append(T)
        for i in range(len(gs)):
            for j in range(i + 1, len(gs)):
                c1, x1, y1, s1, _ = gs[i]
                c2, x2, y2, s2, _ = gs[j]
                w1 = s1 * (0.27 if c1.isascii() else 0.45)  # Latin letters are narrow
                w2 = s2 * (0.27 if c2.isascii() else 0.45)
                ox = min(x1 + w1, x2 + w2) - max(x1 - w1, x2 - w2)
                oy = min(y1 + s1 * 0.45, y2 + s2 * 0.45) - max(y1 - s1 * 0.45, y2 - s2 * 0.45)
                if ox > 0 and oy > 0 and ox * oy > 0.3 * min(2 * w1 * 0.9 * s1, 2 * w2 * 0.9 * s2):
                    hits[shot][f'TEXT-OVERLAP {gs[i][0]}{gs[j][0]}'].append(T)
    bad = 0
    for shot in order:
        found = {k: v for k, v in hits[shot].items() if len(v) >= 3}
        if not found:
            continue
        bad += 1
        print(f'{shot[:60]}')
        for k, v in sorted(found.items(), key=lambda kv: -len(kv[1]))[:6]:
            print(f'    {k:40s} {len(v):3d} frames  {v[0]:.2f}-{v[-1]:.2f}')
    print(f'\n{len(order)} shot combinations, {bad} with findings')


if __name__ == '__main__':
    main()
