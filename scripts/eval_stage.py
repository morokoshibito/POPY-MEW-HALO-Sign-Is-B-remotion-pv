"""Stage edge check from `node scripts/check.mjs cams` logs (no drawing needed).

For every frame of every stage shot (the shots drawn with drawStage), the four screen corners are carried
back through the camera into
  - the stage picture layer (parallax 0.6): EDGE when a corner falls outside the picture, i.e. the screen shows
    past the edge of the stage;
  - the near penlight layer (parallax 1.3): PEN when the bottom edge of the screen reaches below the crowd drawn
    under the sticks (v16: every stick is held by someone; the crowd runs on 4000 px below the shoulders), and
    PENX when a screen corner falls left or right of the outermost sticks (v16: layer x -4600..6500).
Geometry (keep in step with src/scenes/stage2.ts): picture rect and penlight bottom are given below.

usage: python scripts/eval_stage.py cams.jsonl [--pic x0 y0 x1 y1] [--pen ybottom]
"""
import json
import math
import sys

W, H = 1920, 1080
PIC = [-1440, -810, 3360, 1890]  # 4800 x 2700 stage picture centred on the screen (v15: stagePicture ext 2)
PEN_BOTTOM = 1080 + 160 + 62 * 10.2 + 4000  # bottom of the crowd under the near sticks (v16, v17 shorter arms)
PEN_X = [-4600 + 250, 6500 - 250]            # outermost sticks (minus about one spacing)
STAGE = ('pre-show', 'B wide', 'B close', 'B carousel', 'chorus wide', 'bakures', 'bridge empty', 'bridge big',
         'single ', 'B3 kimino', 'interlude photo', 'end credits stage', 'finale')

args = sys.argv[1:]
if '--pic' in args:
    i = args.index('--pic')
    PIC = [float(v) for v in args[i + 1:i + 5]]
    del args[i:i + 5]
if '--pen' in args:
    i = args.index('--pen')
    PEN_BOTTOM = float(args[i + 1])
    del args[i:i + 2]


def to_world(cam, par, sx, sy):
    x, y, z, r = cam
    zp = 1 + (z - 1) * par
    xp = W / 2 + (x - W / 2) * par
    yp = H / 2 + (y - H / 2) * par
    rr = r * par
    dx, dy = (sx - W / 2) / zp, (sy - H / 2) / zp
    c, s = math.cos(-rr), math.sin(-rr)
    return xp + c * dx - s * dy, yp + s * dx + c * dy


shots = {}
for line in open(args[0], encoding='utf-8'):
    line = line.strip()
    if not line or line == 'DONE':
        continue
    d = json.loads(line)
    for lab, z, a, b, cam in d['s']:
        if not cam or not any(lab.startswith(p) for p in STAGE):
            continue
        st = shots.setdefault(lab + f' @{a:.2f}', {'a': a, 'b': b, 'edge': [], 'pen': [], 'penx': [], 'worst_e': 0, 'worst_p': 0, 'worst_x': 0})
        corners = [to_world(cam, 0.6, sx, sy) for sx, sy in ((0, 0), (W, 0), (W, H), (0, H))]
        out = max(max(PIC[0] - cx, cx - PIC[2], PIC[1] - cy, cy - PIC[3]) for cx, cy in corners)
        if out > 0:
            st['edge'].append(d['T'])
            st['worst_e'] = max(st['worst_e'], out)
        bottoms = [to_world(cam, 1.3, sx, H)[1] for sx in (0, W / 2, W)]
        pen = max(bottoms) - PEN_BOTTOM
        if pen > 0:
            st['pen'].append(d['T'])
            st['worst_p'] = max(st['worst_p'], pen)
        # sides: only where the sticks are in the frame (the lower part of the screen)
        xs = [to_world(cam, 1.3, sx, sy)[0] for sx in (0, W) for sy in (H * 0.6, H)]
        px = max(PEN_X[0] - min(xs), max(xs) - PEN_X[1])
        if px > 0:
            st['penx'].append(d['T'])
            st['worst_x'] = max(st['worst_x'], px)

bad = 0
for lab, st in sorted(shots.items(), key=lambda kv: kv[1]['a']):
    flags = []
    if st['edge']:
        flags.append(f"EDGE {st['edge'][0]:.2f}-{st['edge'][-1]:.2f} ({len(st['edge'])} fr, {st['worst_e']:.0f} px past)")
    if st['pen']:
        flags.append(f"PEN {st['pen'][0]:.2f}-{st['pen'][-1]:.2f} ({len(st['pen'])} fr, {st['worst_p']:.0f} px)")
    if st['penx']:
        flags.append(f"PENX {st['penx'][0]:.2f}-{st['penx'][-1]:.2f} ({len(st['penx'])} fr, {st['worst_x']:.0f} px)")
    bad += 1 if flags else 0
    print(f"{'FAIL' if flags else 'ok  '} {st['a']:7.2f}-{st['b']:7.2f} {lab.split(' @')[0]:34s} {'; '.join(flags)}")
print(f"\n{len(shots)} stage shots, {bad} with a visible edge or penlight bottom")
