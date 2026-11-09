"""Camera self-check: measures our camera exactly like the reference camera was measured and checks it against
the rules learnt from reference 2 (tools/track.py -> src/data/ref2_track.json).

usage: python scripts/eval_camera.py <cams.jsonl> [report.txt]
  cams.jsonl comes from: node scripts/check.mjs cams <cams.jsonl> [t0 t1]

Rules (measured on reference 2, 80 shots):
  * never still: inside a shot the screen motion never drops below ~20 px/s (reference: median shot has 0 %
    of frames under 15 px/s, the slowest moment of a median shot is 27 px/s)
  * one U per shot: fast in (median 740 px/s), slow middle (~95 px/s, 20 % of the entry), fast out (~400 px/s)
    -> exactly one slow valley; a second valley (decelerate, re-accelerate, decelerate) is a stutter
  * no reversals inside a shot: translation keeps its direction (consistency 0.82), the roll does not swap
    direction, the zoom does not swap direction
  * across a cut the motion continues: translation direction cos > 0 in 68 % of cuts (median 0.77), the roll
    keeps its sign in 88 %
Screen motion of a frame = RMS displacement of a 5 x 3 grid of screen points (1920 x 1080) between frames.
"""
import json
import math
import sys

import numpy as np

FPS = 30
W, H = 1920, 1080
GX, GY = np.meshgrid(np.linspace(-800, 800, 5), np.linspace(-450, 450, 3))
P = np.stack([GX.ravel(), GY.ravel()], 1)

STALL = 20.0      # px/s
STALL_RUN = 3     # frames
REV_SPEED = 40.0  # px/s, translation reversal only counts above this
ROT_SIG = 0.03    # rad/s
ZOOM_SIG = 0.04   # log-zoom / s


def to_screen(c, p):
    """view(): screen = R(r) * z * (p - c) + centre (p in scene coordinates)."""
    x, y, z, r = c
    q = (p - [x, y]) * z
    cr, sr = math.cos(r), math.sin(r)
    return np.stack([cr * q[:, 0] - sr * q[:, 1], sr * q[:, 0] + cr * q[:, 1]], 1) + [W / 2, H / 2]


def from_screen(c, s):
    x, y, z, r = c
    q = s - [W / 2, H / 2]
    cr, sr = math.cos(-r), math.sin(-r)
    q = np.stack([cr * q[:, 0] - sr * q[:, 1], sr * q[:, 0] + cr * q[:, 1]], 1) / z
    return q + [x, y]


def step(c1, c2):
    """Motion of screen content from camera c1 to c2: (vx, vy) of the centre, roll, log zoom, RMS grid motion."""
    pts = P + [W / 2, H / 2]
    scene = from_screen(c1, pts)
    moved = to_screen(c2, scene)
    d = moved - pts
    centre = to_screen(c2, from_screen(c1, np.array([[W / 2, H / 2]])))[0] - [W / 2, H / 2]
    return centre, c2[3] - c1[3], math.log(c2[2] / c1[2]), float(np.sqrt((d ** 2).sum(1).mean()))


def load(path):
    frames = []
    for ln in open(path, encoding='utf-8'):
        ln = ln.strip()
        if not ln or ln == 'DONE':
            continue
        frames.append(json.loads(ln))
    return frames


def runs(mask):
    best = cur = 0
    for m in mask:
        cur = cur + 1 if m else 0
        best = max(best, cur)
    return best


def main():
    frames = load(sys.argv[1])
    out = open(sys.argv[2], 'w', encoding='utf-8') if len(sys.argv) > 2 else sys.stdout
    # main shot per frame: the base layer (z == 0) shot that started last
    seq = []
    for f in frames:
        base = [s for s in f['s'] if s[1] == 0]
        if not base:
            seq.append((f['T'], None, None))
            continue
        s = max(base, key=lambda s: s[2])
        seq.append((f['T'], (s[0], s[2], s[3]), s[4]))
    # group into shot instances
    shots = []
    for T, key, cam in seq:
        if key is None:
            continue
        if not shots or shots[-1]['key'] != key:
            shots.append({'key': key, 'T': [], 'cam': []})
        shots[-1]['T'].append(T)
        shots[-1]['cam'].append(cam)
    res = []
    for sh in shots:
        label, a, b = sh['key']
        r = {'label': label, 'a': a, 'b': b, 'n': len(sh['T']), 'issues': []}
        if any(c is None for c in sh['cam']):
            r['issues'].append('NO-CAM (motion not declared: cannot be measured)')
            res.append(r)
            continue
        cams = sh['cam']
        if len(cams) < 6:
            r['issues'].append('SHORT')
            res.append(r)
            continue
        st = [step(c1, c2) for c1, c2 in zip(cams[:-1], cams[1:])]
        v = np.array([s[0] for s in st]) * FPS
        w = np.array([s[1] for s in st]) * FPS
        zr = np.array([s[2] for s in st]) * FPS
        mag = np.array([s[3] for s in st]) * FPS
        n = len(mag)
        q = max(1, n // 5)
        e9 = min(q, 9)  # entry / exit: the first / last 0.3 s at most
        r.update(entry=mag[:e9].mean(), mid=mag[2 * q:3 * q].mean() if n >= 5 else mag.mean(), exit=mag[-e9:].mean(), vmin=mag.min(), v_in=v[:3].mean(0), v_out=v[-3:].mean(0), w_in=w[:3].mean(), w_out=w[-3:].mean())
        # stalls (inside the shot; the very first / last frame excluded)
        stall = runs(mag[1:-1] < STALL)
        if stall >= STALL_RUN:
            r['issues'].append(f'STALL {stall} frames < {STALL:.0f} px/s (min {mag.min():.0f})')
        # stutter: valleys in the smoothed speed (one U valley allowed)
        sm = np.convolve(mag, np.ones(3) / 3, mode='same')
        valleys = 0
        for i in range(2, n - 2):
            if sm[i] <= sm[i - 1] and sm[i] < sm[i + 1]:
                # a real dip: the speed rises again within half a second on both sides (a U's long slow middle
                # is not a dip)
                left = sm[max(0, i - 15):i].max()
                right = sm[i + 1:i + 16].max()
                if sm[i] < 0.7 * min(left, right) and min(left, right) - sm[i] > 25:
                    valleys += 1
        allowed = 1
        if '[chain ' in label:
            allowed = int(label.split('[chain ')[1].split(']')[0])
        if '[path]' in label or '[spring]' in label:
            allowed = 99  # a path through framings / an elastic arrival: slow-downs and turns are its design
        if valleys > allowed:
            r['issues'].append(f'STUTTER {valleys} slow-downs ({allowed} U allowed)')
        # translation reversal against the shot's dominant direction
        sig = np.linalg.norm(v, axis=1) > REV_SPEED
        if sig.sum() >= 3 and '[path]' not in label and '[spring]' not in label:
            u = v[sig].sum(0)
            if np.linalg.norm(u) > 1e-6:
                u = u / np.linalg.norm(u)
                back = (v @ u < -0.3 * np.linalg.norm(v, axis=1)) & sig
                if runs(back) >= 3:
                    r['issues'].append('REVERSE translation goes back against the shot direction')
        # roll / zoom reversal
        for name, arr, thr in (('roll', w, ROT_SIG), ('zoom', zr, ZOOM_SIG)):
            if (name == 'roll' and '[alt]' in label) or '[path]' in label or '[spring]' in label:
                continue  # the roll turns with each singer on purpose
            sgn = np.where(arr > thr, 1, np.where(arr < -thr, -1, 0))
            pos, neg = runs(sgn > 0), runs(sgn < 0)
            if pos >= 3 and neg >= 3:
                r['issues'].append(f'REVERSE {name} changes direction')
        # dominant kind of motion (reference 2: sideways pans 28 %, tilts 38 %, zoom / roll / mixed 35 %)
        tot = mag.sum() + 1e-6
        hx = np.abs(v[:, 0]).sum() / tot
        vy = np.abs(v[:, 1]).sum() / tot
        r['kind'] = 'pan-x' if hx > 0.6 else 'pan-y' if vy > 0.6 else 'zoom/roll'
        if r['entry'] < 1.5 * r['mid'] and r['b'] - r['a'] > 0.45 and '[chain ' not in label and '[path]' not in label:
            r['issues'].append(f"FLAT-IN entry {r['entry']:.0f} vs middle {r['mid']:.0f} px/s (want a fast arrival)")
        res.append(r)
    # cut continuity
    for r1, r2 in zip(res[:-1], res[1:]):
        if 'v_out' not in r1 or 'v_in' not in r2 or abs(r1['b'] - r2['a']) > 0.05:
            continue
        a, b = r1['v_out'], r2['v_in']
        if '[turn]' in r2['label'] or '[alt]' in r2['label']:
            continue
        if np.linalg.norm(a) > 60 and np.linalg.norm(b) > 60:
            cos = float(a @ b / np.linalg.norm(a) / np.linalg.norm(b))
            if cos < -0.2:
                r2['issues'].append(f'CUT-FLIP translation turns back across the cut (cos {cos:.2f})')
        if abs(r1['w_out']) > 0.15 and abs(r2['w_in']) > 0.15 and np.sign(r1['w_out']) != np.sign(r2['w_in']):
            r2['issues'].append('CUT-FLIP roll changes direction across the cut')
    # variety: never more than two sideways pans in a row (reference: longest run 3 of 80 shots, 28 % overall)
    run = 0
    for r in res:
        if r.get('kind') == 'pan-x' and r['b'] - r['a'] > 0.6:
            run += 1
            if run >= 3:
                r['issues'].append(f'MONOTONE {run} sideways pans in a row')
        else:
            run = 0
    kinds = [r.get('kind') for r in res if 'kind' in r]
    share = kinds.count('pan-x') / max(1, len(kinds))
    bad = 0
    for r in res:
        sp = f"in {r.get('entry', 0):5.0f} mid {r.get('mid', 0):4.0f} out {r.get('exit', 0):5.0f} min {r.get('vmin', 0):4.0f}" if 'entry' in r else ' ' * 38
        flag = ('OK  ' if not r['issues'] else 'FAIL') + f" {r.get('kind', '-'):9s}"
        bad += bool(r['issues'])
        print(f"{flag} {r['a']:7.2f}-{r['b']:7.2f} {r['label'][:34]:34s} {sp}  {'; '.join(r['issues'])}", file=out)
    print(f'\n{len(res)} shots, {bad} with issues. Sideways-pan shots: {share:.0%} (reference 28 %). Reference medians: in 740, mid 95, out 395 px/s; no stalls.', file=out)


if __name__ == '__main__':
    main()
