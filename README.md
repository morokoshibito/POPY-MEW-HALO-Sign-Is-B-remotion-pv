# サインはB — 梦的结唱翻唱 MV（POPY / MEW / HALO）

Remotion 4 工程。每一帧只由时间决定：Canvas2D 绘制画面和当前舞台，WebGL2 负责画面后期。

## 关于本仓库

- 这是一个源码公开、仅限非商业使用的工程，条款见 `LICENSE`。
- 全片演出参数集中在 `src/tuning.ts`，每一项都有中文注释；按视频时间段整理的说明见 `docs/parameters.md`。
- **仓库不包含**：歌曲和演唱音轨（`public/audio/`）、渲染出来的视频、演出设计的版本记录。人设图和背景图等素材在 `public/` 里，但不在 `LICENSE` 的授权范围内，版权归各自所有者。
- 没有音频文件时，工程可以预览画面，但没有声音，也无法对时间；需要自己放入音轨（见下文「换成你的混音」）。

## 第一次运行（Windows）

1. 安装 Node.js 18 以上和 Python 3。
2. 在工程文件夹里执行 `npm install`。
3. 预览：`.\scripts\studio.bat`，浏览器里拖时间轴，有声音。
4. 渲染：`.\scripts\render.bat preview`（半尺寸）、`.\scripts\render.bat full`、`.\scripts\render.bat range 52 63`、`.\scripts\render.bat still 64.5`。画面全黑时在后面加 `--gl=swangle`；内存不够时加 `--concurrency=4`。
5. 两个 .bat 已经设了 `NODE_OPTIONS=--dns-result-order=ipv4first`（解决 `ECONNREFUSED ::1:3000`）。如果直接用 `npx remotion ...`，先在 PowerShell 执行 `$env:NODE_OPTIONS="--dns-result-order=ipv4first"`。

## 现在是什么状态

- 时间、分词、歌词都是正式数据：来自你的 SVP（`src/data/lyrics.json`）。
- 立绘已接入：`public/chars/` 里是处理过的 14 张图（2 倍放大、抠成透明、被画框切掉的手脚做了渐隐）。脸的位置在 `public/chars/crops.json`。
- 声音是参考 MV 的音轨（`public/audio/ref.m4a`，不在仓库里），只用于对时间。

## 立绘重新生成后

把新图放进一个文件夹（文件名照旧，如 `popy_main.png`），运行：

```
python scripts/prep_chars.py <新图文件夹> public/chars <模型文件夹>
```

模型文件夹需要三个文件：`isnet-anime.onnx`（github.com/danielgatis/rembg releases）、`lbpcascade_animeface.xml`（github.com/nagadomi/lbpcascade_animeface）、以及由 `python scripts/esrgan_onnx.py convert realesr-animevideov3.pth esrgan_av3.onnx` 生成的放大模型（.pth 来自 github.com/xinntao/Real-ESRGAN releases v0.2.5.0）。需要 `pip install onnxruntime onnx opencv-python scipy pillow`。换了构图的图，要同时改 `crops.json` 里那张的脸部坐标。

**抠完以后再清一遍灰底（第 17 版起）**：生成图是灰底，`prep_chars.py` 会把被头发围住的灰色小块当成人物保留下来（浅色头发最明显，HALO 的头发里有大块灰色）。对每张图运行：

```
python scripts/fix_grey_pockets.py public/chars/halo_full.png public/chars/halo_full.png [检查图.png]
```

它把夹在头发、缎带、袖子之间的整块灰色变透明，并把边缘像素里混进去的灰色扣掉。检查图三栏依次是：原图、绿色标出删掉的部分、处理后（都放在深紫底上）。

**表情差分**：全身图的表情是把改过脸的头像贴回全身图（`scripts/face_patch.py <立绘文件夹> <头像文件夹> <输出文件夹> <检查图文件夹>`）。头像文件名是 `<成员>_face_<表情>.png`，是全身图头部的正方形截图改了脸。全身图重新抠过以后要重跑一次这一步。

## 常改的地方

整片以第二参考（りりむ / 葛葉 / 卯月コウ 版）为准，画面时间 = 第二参考的时间 + 2.5 秒。逐段分镜、实测数据和第二轮研究笔记在 `docs/ref2_shotlist.md`。

| 想改 | 文件 |
| --- | --- |
| **常用演出参数（时机、速度、幅度、颜色、背景）** | **`src/tuning.ts`**（说明 `docs/parameters.md`） |
| 代表色、强刺激效果开关、音频文件 | `src/config.ts` |
| 哪段用哪个模板、切点、B 段分句、署名、片头每遍蹦出来的成员 | `src/direction.ts` |
| 平面段（片头/重复/片尾、三遍 CHU、署名聚光灯、聚光灯巡游、念白肖像、オレモー、Pre 叠层、君も 钟摆、お待ちどうさま、A 段胶囊、フワ、彩色三人、損 卡牌、桥段快切） | `src/scenes/g9.ts` |
| 荧光棒转场：0:18 挥过镜头的大荧光棒（`joinPenlightSwing`）、A 段切卡牌和桥段的荧光棒擦除（`joinPenlightWipe`） | `src/scenes/penlightWipe.ts` |
| 平面段素材（偶像图案底纹、聚光灯、观众荧光棒 `penCrowd`、爱心对话框 `loveBubbles`、快速上浮的星星爱心 `riseShapes`、话筒） | `src/scenes/popkit.ts` |
| 舞台段（B 段连续运镜和轮盘、副歌全景、独唱、爆レス、桥段、B3、片尾署名、结尾、边缘虚化、顶层光晕、逐字入场动画 `glyphWord`） | `src/scenes/stage2.ts` |
| 镜头：`glide` / `glideChain`（参考二实测的规则：快速切入、中段慢但不停、加速切出，每个通道全程同一方向；默认画面向右走时顺时针转）。**不加任何运动模糊/拖影**：`rigBlur` 已停用，`src/lib/post.ts` 的 `NO_SMEAR` 把径向、旋转、方向模糊在最后一道强制归零，歌词字的残影 `TEXT_TRAILS` 也关闭 | `src/lib/rig.ts` |
| 镜头：`refRig`（照搬第二参考同一时刻实测的镜头运动：推拉、旋转、平移，可按比例减弱） | `src/lib/reftrack.ts`，数据 `src/data/ref2_track.json`，逐镜验证 `docs/ref2_track_shots.tsv` |
| 人物摆放：`figAt` 按脸的位置和脸的高度摆，三人的头一样大 | `src/lib/draw.ts` |

`src/scenes/ref2.ts`（标题字、片头时间）、`templates.ts`（`Part`/`Shot` 类型、闪白、调色）、`styles.ts`（字形样式）只剩仍在使用的部分。

荧光棒摆动：舞台段每一小节摆一边（`penCrowd` 的 `beats` 和舞台段 `penBeats`，8 拍一个来回），副歌也不加快。0:14–18 署名段和 2:37–41 桥段的观众荧光棒另有规则：一小节一个左右轮回，喊 call 时抬起，参数在 `tuning.ts` 的 `CROWD_CALLS`。

胶片颗粒已经关掉（`src/lib/post.ts` 里 `noFx` 的 `grain: 0`）：画面上细密的点状纹路就是它，每帧都在变，压缩后更明显。想要一点颗粒感可以改回 0.01 左右。

## 表情差分

全身图的表情差分 `public/chars/<成员>_full_<laugh|wink|kiss|soft|smug>.png` 是原全身图只换了脸（对齐后用遮罩贴上的，身体完全一样，所以镜头里可以随时换表情）。重新生成脸部补丁后，用 `python scripts/face_patch.py public/chars <补丁文件夹> public/chars <调试输出文件夹>` 重新合成。各段用哪个表情：舞台段在 `stage2.ts` 的 `faces([...])`，平面段在 `g9.ts` 里各个 `figAt(..., 'full_xxx', ...)`。

## 只看静帧（不渲视频）

```
node scripts/stills.mjs out/stills 0.5 8.25 19.2 82.1
```

参数是输出文件夹、缩放（0.5 = 960×540）、若干个**代码时间** T（= 成片时间 + 1.167）。Windows 上同样在工程文件夹里执行。

## 自检

见 `docs/self_check.md`：镜头检查（静止、卡顿、反向、切点方向）、构图检查（脸被挡、字压脸、字重叠）、人物曝光检查（成品画面里的脸和原图比，`eval_expo.py`）、舞台边缘和荧光棒末端检查（`eval_stage.py`）。都不渲视频。

## 自己生成素材（可选）

- `public/props/mic.png`：话筒（透明背景，话筒头朝上、手柄朝下，竖直摆放）。放进去以后，サインは 那一镜如果没有 `mic_black.png` 会用它。片头开场和背景图案里已经不再有话筒。
- `public/props/mic_black.png`：黑色话筒，サインは 那一镜用。
- `public/bg/stage_pink.png`：舞台背景，见下节。

## SVP 改了以后

`.\scripts\align.bat "D:\路径\你的工程.svp"` 重新生成歌词时间，报告在 `lyrics/timing_report.txt` 和 `lyrics/parts_report.txt`。只改了 `src/` 不需要重跑。

## 换成你的混音

把混音放进 `public/audio/`，在 `src/config.ts` 改 `AUDIO_FILE`；`AUDIO_AT` 是混音开始播放的秒数。画面时间 = 伴奏时间 + 2.298 秒，所以混音如果从伴奏起点导出，`AUDIO_AT = 2.298`；如果从 SVP 工程起点导出，`AUDIO_AT = 2.298 - 0.889 = 1.409`。

## 字体

M PLUS Rounded 1c（SIL OFL 1.1，许可证在 `public/fonts/`）。片尾署名用的是 Yusei Magic（同上）。

两种字体都只有日文用字：简体中文独有的字（如 张、刘、陈、东、们）它们没有，浏览器会临时换成系统字体，和别的字风格不一样。署名里如果要用这类字，请告诉我，我换一个覆盖简体中文的字体（或只给署名单独换字体）。

## 署名（第 16 版）

片尾署名在 `src/direction.ts` 顶部的 `ENDING_CREDITS`：把 `xxxxx` 换成你的名字。`small: true` 的一行是小字标题（VOCAL、TUNING・MV），和它下面那一行同时出现。

## 舞台背景图（虚化舞台段用）

把生成的图放进 `public/bg/`，文件名：

- `stage_pink.png`（或 .jpg / .webp）：所有舞台段都用这一张（B 段、副歌、爆レス、桥段、B3、片尾署名、结尾）。

没有这张图时，代码会画一个参考二式的 2D 舞台（台阶灯带、LED 屏、灯架、激光）顶替，工程照样能跑。第 15 版起这个代码舞台的长宽各扩大到 2 倍（四周接上灯架、侧屏、顶部灯排，台阶一直延伸到镜头前），快速拉远也不会露出边缘。图会被代码虚化，所以不需要你先模糊。建议 16:9，至少 2560×1440。注意：放进自己的图后，它只覆盖原来的范围（约 1.25 个画面），快速拉远会露边，那时要用更大的图（见第 15 版说明）。
