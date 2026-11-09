"""Summarise probe output (self-check only).
Checks per frame:
  1. glyphs whose box leaves the frame
  2. figures mostly outside the frame (visible < 30 % of their box) - listed per shot, may be intended
  3. cut-border fixes applied (where the picture had to be enlarged)
  4. reading order: glyphs that appear in a row/column before a glyph that precedes them
     (horizontal rows must fill left -> right; vertical columns top -> bottom; columns right -> left)
Usage: python probe_report.py probe_*.jsonl
"""
import json
import sys
from collections import defaultdict

W, H = 1920, 1080
frames = []
for path in sys.argv[1:]:
    for line in open(path):
        line = line.strip()
        if not line or line == 'DONE':
            continue
        frames.append(json.loads(line))
frames.sort(key=lambda f: f['T'])

out_glyph = defaultdict(list)
out_fig = defaultdict(list)
fixes = defaultdict(list)


def vis_frac(c):
    xs = [p[0] for p in c]
    ys = [p[1] for p in c]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    area = max(1, (x1 - x0) * (y1 - y0))
    ix = max(0, min(x1, W) - max(x0, 0))
    iy = max(0, min(y1, H) - max(y0, 0))
    return ix * iy / area


for f in frames:
    key = ' | '.join(f['shots'])
    for ch, x, y, s, a in f['gs']:
        h = s * 0.5
        if x - h < -2 or x + h > W + 2 or y - h < -2 or y + h > H + 2:
            out_glyph[key].append((f['T'], ch, x, y, s))
    vs = [vis_frac(fig['c']) for fig in f['figs']]
    if vs and max(vs) < 0.12:
        out_fig[key].append((f['T'], ','.join(fig['m'] for fig in f['figs']), '', round(max(vs), 2)))
    for fx in f['fixes']:
        fixes[key].append((f['T'], fx['m'], fx['k'], round(fx['f'], 2)))

print('== 1. glyphs outside the frame')
for k, v in out_glyph.items():
    print(f'  {v[0][0]:.1f}-{v[-1][0]:.1f} {k}: {len(v)} e.g. {v[0][1:]}')
if not out_glyph:
    print('  none')
print('== 2. frames whose figures are all (almost) outside the frame')
for k, v in out_fig.items():
    ms = sorted(set(x[1] for x in v))
    print(f'  {v[0][0]:.1f}-{v[-1][0]:.1f} {k}: {ms} min vis {min(x[3] for x in v)}')
if not out_fig:
    print('  none')
print('== 3. hard picture edges visible inside the frame (hands / hair / legs cut)')
for k, v in fixes.items():
    fs = sorted(set((x[1], x[2]) for x in v))
    print(f'  {v[0][0]:.1f}-{v[-1][0]:.1f} {k}: {fs} max f {max(x[3] for x in v)}')
if not fixes:
    print('  none')

# 4. reading order
print('== 4. reading order violations')
viol = defaultdict(list)
prev = None
for f in frames:
    gs = [(ch, x, y, s) for ch, x, y, s, a in f['gs'] if a > 0.5]
    if prev is not None and abs(f['T'] - prev['T']) < 0.15:
        old = [(ch, x, y, s) for ch, x, y, s, a in prev['gs'] if a > 0.5]

        def known(g):
            return any(o[0] == g[0] and abs(o[1] - g[1]) < max(40, g[3] * 0.6) and abs(o[2] - g[2]) < max(40, g[3] * 0.6) for o in old)

        new = [g for g in gs if not known(g)]
        stay = [g for g in gs if known(g)]

        def vertical(g):
            # part of a vertical column: a neighbour straight above or below at about one glyph pitch
            return any(o is not g and abs(o[1] - g[1]) < g[3] * 0.3 and 0.6 * g[3] < abs(o[2] - g[2]) < 1.5 * g[3] for o in gs)

        for g in new:
            # same row: |dy| small, similar size
            row = [o for o in stay if abs(o[2] - g[2]) < g[3] * 0.35 and 0.6 < o[3] / g[3] < 1.6 and abs(o[1] - g[1]) < g[3] * 3]
            col = [o for o in stay if abs(o[1] - g[1]) < g[3] * 0.35 and 0.6 < o[3] / g[3] < 1.6 and abs(o[2] - g[2]) < g[3] * 3]
            if vertical(g):
                row = []
            if row and len(row) >= len(col) and any(o[1] > g[1] + g[3] * 0.3 for o in row):
                viol[' | '.join(f['shots'])].append((f['T'], g[0], 'row: appears left of an earlier glyph'))
            elif col and len(col) > len(row) and any(o[2] > g[2] + g[3] * 0.3 for o in col):
                viol[' | '.join(f['shots'])].append((f['T'], g[0], 'column: appears above an earlier glyph'))
    prev = f
for k, v in viol.items():
    print(f'  {v[0][0]:.1f}-{v[-1][0]:.1f} {k}: {len(v)} e.g. {v[:3]}')
if not viol:
    print('  none')
print(f'frames: {len(frames)}  T {frames[0]["T"]:.1f}-{frames[-1]["T"]:.1f}')
