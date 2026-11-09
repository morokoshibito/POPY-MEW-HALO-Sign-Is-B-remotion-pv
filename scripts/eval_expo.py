"""Face exposure report from `node scripts/check.mjs expo` logs.

Every face drawn in colour is compared with the same face in the source picture (final image, post pass
included). Per face: mean lightness L, the dark end p5 (line art, pupils), the share of clipped pixels (L > 0.985) and
the saturation. The art itself is the reference: the PV must not wash it out.

  The source face is resampled to its on-screen size first.
  OVER    p5 lifted by more than 0.07, or L up by more than 0.05, or 10 % more clipped pixels
  WASHED  saturation below 82 % of the source

usage: python scripts/eval_expo.py log1.jsonl [log2.jsonl ...] [--all]
"""
import json
import sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
show_all = '--all' in sys.argv
rows = []
for f in args:
    for line in open(f, encoding='utf-8'):
        line = line.strip()
        if not line or line == 'DONE':
            continue
        rows.append(json.loads(line))
rows.sort(key=lambda r: r['T'])

bad = 0
by_shot = {}
for r in rows:
    Lr, p5r, cr, sr = r['r']
    Ls, p5s, cs, ss = r['s']
    flags = []
    if p5r - p5s > 0.07 or Lr - Ls > 0.05 or cr - cs > 0.10:
        flags.append('OVER')
    if ss > 0.05 and sr / ss < 0.82:
        flags.append('WASHED')
    shot = ' / '.join(r['shots'][:2]) if r.get('shots') else '?'
    key = shot
    st = by_shot.setdefault(key, {'n': 0, 'bad': 0, 'dL': 0.0, 'dp5': 0.0, 'sat': 0.0, 't0': r['T'], 't1': r['T']})
    st['n'] += 1
    st['bad'] += 1 if flags else 0
    st['dL'] += Lr - Ls
    st['dp5'] += p5r - p5s
    st['sat'] += (sr / ss) if ss > 0.05 else 1
    st['t1'] = r['T']
    if flags:
        bad += 1
    if flags or show_all:
        print(f"{'/'.join(flags) or 'OK':10s} {r['T']:7.2f} {r['m']:4s} {r['k']:10s} h{r['hp']:4d}  L {Lr:.2f}/{Ls:.2f}  p5 {p5r:.2f}/{p5s:.2f}  clip {cr:.2f}/{cs:.2f}  sat {sr:.2f}/{ss:.2f}  {shot}")

print()
print('per shot (mean over faces): dL, dp5, saturation ratio')
for k, st in sorted(by_shot.items(), key=lambda kv: kv[1]['t0']):
    n = st['n']
    mark = 'FAIL' if st['bad'] else 'ok  '
    print(f"{mark} {st['t0']:7.2f}-{st['t1']:7.2f}  dL {st['dL'] / n:+.3f}  dp5 {st['dp5'] / n:+.3f}  sat {st['sat'] / n:.2f}  ({st['bad']}/{n})  {k}")
print(f"\n{len(rows)} faces, {bad} flagged")
