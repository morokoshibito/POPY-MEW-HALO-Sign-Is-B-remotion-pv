# Self-check (no video is rendered)

Two measurements run on the timeline itself and report problems per shot. Run them after every change.
Neither renders video; both run in a headless browser.

## 1. Camera: `scripts/eval_camera.py`

```
node scripts/check.mjs cams out/cams.jsonl 0 224.2      # about 30 s
python scripts/eval_camera.py out/cams.jsonl out/cam_report.txt
```

- **What it measures:** every shot declares its camera (`Shot.cam`). The check samples it at 30 fps and
  measures the motion of the picture, as the reference camera was measured. The figure is the RMS
  displacement of a 5 × 3 grid of screen points from one frame to the next, in px/s.
- **The rules,** measured on the 80 shots of reference 2 (every frame of the reference was matched with
  ORB + RANSAC; see `tools/track.py`):

| Rule | Reference | Report entry |
|---|---|---|
| Never still inside a shot | median shot: 0 % of frames under 15 px/s; slowest moment 27 px/s | `STALL` (3 frames under 20 px/s) |
| One U per shot: fast in, slow (but moving) middle, fast out | in 740 / middle 95 / out 395 px/s | `STUTTER` (a second slow-down), `FLAT-IN` |
| No reversal inside a shot | translation consistency 0.82 | `REVERSE` (translation, roll or zoom) |
| The motion continues across a cut | translation cos > 0 in 68 % of cuts, roll keeps its sign in 88 % | `CUT-FLIP` |

- **Variety rule** (`MONOTONE`): never three sideways pans in a row. Each shot is classed by its dominant
  motion: sideways pan, tilt, or zoom / roll / mixed. Reference 2 is 28 % sideways pans, 38 % tilts and
  35 % zoom / roll / mixed, and its longest run of sideways pans is 3. Version 11 broke this rule everywhere
  (the user: "abusing the horizontal fan pan"); this check now catches it.
- **Allowed exceptions:**
  - A shot marked `turn: true` may change direction at its cut, because a wipe hides it (iris, star burst).
  - A chained camera (`glideChain`, label `[chain N]`) may have N slow-downs.
- **Label tags:**
  - `[path]`: one continuous camera path through framings (`flow`); turns and slow-downs are its design,
    but stalls are still checked.
  - `[spring]`: an elastic arrival.
  - `[alt]`: the roll alternates with the singer (Pre) or the swing alternates (pendulum).
- **No smear, ever (user rule, v14):** no motion blur, no drag after-images, no ghost copies, on the camera
  or on text. `rigBlur` is off; `NO_SMEAR` in `src/lib/post.ts` forces the radial / spin / directional blur
  to zero at the last pass whatever a scene asks for; `TEXT_TRAILS` in `src/lib/fancy.ts` is off. The sense
  of speed comes only from the camera's own speed and amplitude. Depth of field (the blurred stage behind, the
  solo's requested blur) is not a smear and stays; (v15, user) no blur going into or out of a shot either, at
  any speed.
- **No white hiding a still camera (user rule, v15):** a flash or white at a cut sits on the last frames of a
  visible, accelerating move into the cut (`intoCut` in `src/lib/rig.ts`: an exponential ramp of push / pull,
  turn and travel over the last 0.3-0.75 s), never in place of it.
- **How the cameras are built:** the right tool for each shot, not one tool for all:
  - `flow`: a spline path through framings that never stops; one shot that goes somewhere.
  - `glide`: a U-shaped move in one direction; use it for pushes, pulls and tilts as much as for pans.
  - `glideSeq`: several moves in one shot (Pre).
  - `live`: offsets with a drift.
  - `refRig`: the measured reference camera.

## 2. Composition: `scripts/eval_frame.py`

```
node scripts/check.mjs probe out/probe.jsonl 0 224.2 0.1     # slow: run in parts in parallel
python scripts/eval_frame.py out/probe*.jsonl
```

| Report entry | Meaning |
|---|---|
| `FACE-HIDDEN a behind b` | at least a third of a's face is covered by the opaque pixels of a figure drawn in front (checked on the picture's alpha) |
| `TEXT-ON-FACE` | a lyric glyph sits on a face |
| `TEXT-OVERLAP` | two glyphs run into each other |
| `FACE-OUT` | more than half of a face is outside the frame for a while |

`scripts/probe_report.py` still reports glyphs outside the frame, empty frames, visible hard picture
edges and reading order.

## 3. Face exposure: `scripts/eval_expo.py` (v15)

```
node scripts/check.mjs expo out/expo.jsonl <t0> <t1> <dt>      # final image, post pass included
python scripts/eval_expo.py out/expo*.jsonl [--all]
```

Every face drawn in colour is read back from the finished frame and compared with the same face in the
source picture, resampled to its on-screen size: mean lightness `L`, the dark end `p5` (line art, pupils),
the share of clipped pixels (L > 0.985) and the saturation. The art is the reference: the PV must not wash
it out.

| Report entry | Meaning |
|---|---|
| `OVER` | p5 lifted by more than 0.07, or L up by more than 0.05, or 10 % more clipped pixels than the art |
| `WASHED` | saturation below 82 % of the art |

What it found in v14: the bloom (0.3 from 0.86) screened the pastel grounds over the faces; the stage
diffusion was screened over the finished frame, members included; a lift raised every dark line; a 4 %
contrast and 6 % saturation push sent the light skin into pure white (20-50 % of a face clipped against
~1 % in the art). Now: bloom 0.12 from 0.96 only, diffusion behind the members, no lift, neutral contrast and
saturation. Faces measure within +-0.02 of the art. Out-of-focus back members still read lighter (blur).

## 4. Stage edges and penlight ends: `scripts/eval_stage.py` (v15)

```
node scripts/check.mjs cams out/cams.jsonl 0 224.2
python scripts/eval_stage.py out/cams.jsonl
```

Carries the screen corners back through every stage camera into the stage picture layer (parallax 0.6) and
the near penlight layer (parallax 1.3): `EDGE` = the screen shows past the stage picture, `PEN` = a penlight's
end can show. The picture rectangle and the shallowest stick end are constants at the top of the script:
keep them in step with `stagePicture` and `penlights` in `src/scenes/stage2.ts`.

## 5. Still contact sheets (for things only eyes can judge)

Use these for colour, style, readability and whether a picture is too empty:

```
node scripts/check.mjs sheet out/sheet.png <t0> <dt> <n> [cols] [scale]
```

## 第 16 版补充
- `eval_stage.py`：荧光棒下面现在有观众（人群一直延伸到 PEN_BOTTOM），所以 PEN 改为检查是否露出人群下沿；新增 PENX：画面两侧超出最外侧荧光棒（layer x −4600…6500）时报警。
- 副歌调色 `CHORUS_GRADE`（`stage2.ts`）：实测曝光 ×1.02 就会让 HALO 的脸 50 % 像素过曝，所以只加泛光（0.2，阈值 0.9），脸和原图的亮度差约 +0.006。

## 第 17 版补充
- 立绘灰底：`scripts/fix_grey_pockets.py` 清掉头发之间残留的灰底块，并把边缘混进去的灰色扣掉。HALO 全身图里接近灰底颜色的不透明像素从约 8.6 万降到约 4 千（剩下的是衣服本身的阴影）。
- `eval_stage.py`：观众的手臂缩短后，人群下沿改为 H + 160 + 62 × 10.2 + 4000。
