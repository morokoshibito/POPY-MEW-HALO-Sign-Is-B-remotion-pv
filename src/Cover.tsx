// Cover (thumbnail) stills, drawn with the MV's own stage, art and title. Two designs, each 16:9 and 4:3:
//   A = the title shot of the intro (0:10, the three close, サインはB under them) on the purple B3 stage
//   B = the last shot of the MV (3:39, the three on the stage, the title over them)
// Render locally (stills, not video):
//   npx remotion still src/index.ts CoverA169 out/coverA_16x9.png
//   npx remotion still src/index.ts CoverA43  out/coverA_4x3.png
//   npx remotion still src/index.ts CoverA11  out/coverA_1x1.png
//   npx remotion still src/index.ts CoverB169 out/coverB_16x9.png
//   npx remotion still src/index.ts CoverB43  out/coverB_4x3.png
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {COLORS, H, Member, NAMES, W} from './config';
import {Kind, loadAssets} from './lib/assets';
import {figAt} from './lib/draw';
import {Fx, Post, noFx} from './lib/post';
import {Cam, Rig, inCam} from './lib/rig';
import {DEADLINE} from './lib/type';
import {floatGlow, titleFancy} from './scenes/g9';
import {sparkles} from './scenes/popkit';
import {LAY_B, stageShots} from './scenes/stage2';
import {Part} from './scenes/templates';

type Ctx = CanvasRenderingContext2D;

/** Everything to tune, per cover. The picture is always drawn as a 1920x1080 MV frame; a 4:3 cover is its centre
 *  1440 px (keep it inside x 240..1680). Positions are the MV's: members in scene px through `cam`, title in
 *  frame px. */
export type CoverSpec = {
  width: 1920 | 1440 | 1080;
  design: 'A' | 'B';
  T: number; // moment of the stage lights / sparkles used
  stageCam: Cam; // camera on the stage picture (background)
  cam: Cam; // camera on the three
  pos: Record<Member, [number, number, number]>; // x, y (face), face height - scene px
  faces: Record<Member, Kind>;
  bgBlur: number; // background out of focus (0 = sharp)
  title: {x: number; y: number; scale: number};
  tag: boolean; // small "Synthesizer V AI COVER / POPY MEW HALO" tag at the top left
};

// A: the intro title shot (0:10: camera x1.12, roll -0.075; the same stand as in the MV), on the purple stage
// (v28, user) POPY up and a little left, as in the MV's 0:10 shot
const A_POS: Record<Member, [number, number, number]> = {mew: [470, 300, 235], popy: [990, 430, 258], halo: [1420, 320, 235]};
const A_FACES: Record<Member, Kind> = {mew: 'full_laugh', popy: 'full_wink', halo: 'full_laugh'};
export const COVER_A169: CoverSpec = {
  width: 1920,
  design: 'A',
  T: 176.2,
  stageCam: {x: 960, y: 330, z: 1.0, r: -0.075},
  cam: {x: 960, y: 540, z: 1.12, r: -0.075},
  pos: A_POS,
  faces: A_FACES,
  bgBlur: 8,
  title: {x: 960, y: 860, scale: 0.95},
  tag: false,
};
export const COVER_A43: CoverSpec = {
  ...COVER_A169,
  width: 1440,
  // pulled back so MEW's face and HALO's stay inside the 4:3 frame
  cam: {x: 965, y: 560, z: 0.9, r: -0.075},
  title: {x: 960, y: 880, scale: 0.86},
};

// B: the last shot (3:39.6: camera x1.0 at the centre), the finale faces
const B_POS: Record<Member, [number, number, number]> = Object.fromEntries(LAY_B.map((p) => [p.m, [p.x, p.fy, p.f]])) as Record<Member, [number, number, number]>;
export const COVER_B169: CoverSpec = {
  width: 1920,
  design: 'B',
  T: 220.785,
  stageCam: {x: 957, y: 543, z: 0.996, r: -0.0045},
  cam: {x: 957, y: 543, z: 0.996, r: -0.0045},
  pos: B_POS,
  faces: {mew: 'full_wink', popy: 'full_kiss', halo: 'full_laugh'},
  bgBlur: 0,
  title: {x: 960, y: 860, scale: 0.9},
  tag: false,
};
export const COVER_B43: CoverSpec = {
  ...COVER_B169,
  width: 1440,
  stageCam: {x: 980, y: 560, z: 0.86, r: -0.0045},
  cam: {x: 980, y: 560, z: 0.86, r: -0.0045},
  title: {x: 960, y: 880, scale: 0.8},
};

// (v28) 1:1: the centre 1080 px; pulled back further so the three fit side by side
export const COVER_A11: CoverSpec = {
  ...COVER_A169,
  width: 1080,
  cam: {x: 960, y: 590, z: 0.72, r: -0.075},
  title: {x: 960, y: 900, scale: 0.68},
};

export const COVERS = {A169: COVER_A169, A43: COVER_A43, A11: COVER_A11, B169: COVER_B169, B43: COVER_B43};

const capsule = (ctx: Ctx, x: number, y: number, w: number, h: number, fill: string) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
};

/** Optional small tag (top left of the cover's frame). */
const coverTag = (ctx: Ctx, s: CoverSpec) => {
  ctx.save();
  ctx.translate((W - s.width) / 2 + 56, 52);
  ctx.font = `900 34px "MPR", sans-serif`;
  ctx.textBaseline = 'middle';
  const t = 'Synthesizer V AI COVER';
  const w = ctx.measureText(t).width;
  ctx.shadowColor = 'rgba(40,10,50,0.35)';
  ctx.shadowBlur = 12;
  capsule(ctx, 0, 0, w + 44, 56, 'rgba(255,255,255,0.92)');
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#3a2340';
  ctx.fillText(t, 22, 30);
  let x = w + 58;
  (['popy', 'mew', 'halo'] as Member[]).forEach((m) => {
    const tw = ctx.measureText(NAMES[m]).width;
    capsule(ctx, x, 0, tw + 36, 56, COLORS[m].main);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(NAMES[m], x + 18, 30);
    x += tw + 46;
  });
  ctx.restore();
};

/** The cover as one MV-style part: the stage (purple for A), the three drawn sharp over it, sparkles, the title. */
const coverPart = (s: CoverSpec): Part => {
  const rig: Rig = () => s.stageCam;
  const a = s.T - 1;
  const b = s.T + 1;
  return stageShots(
    [
      {
        a,
        b,
        label: `cover ${s.design}`,
        // the stage without the three and without the out-of-focus penlights in front; the three are drawn
        // sharp over the stage's light (the haze and the beams would wash them out)
        scene: {members: [], pen: 0, dark: s.design === 'A'},
        rig,
        bgBlur: s.bgBlur,
        text: (ctx, T) => {
          inCam(ctx, s.cam, () => (['halo', 'mew', 'popy'] as Member[]).forEach((m) => {
            const [x, y, f] = s.pos[m];
            figAt(ctx, m, s.faces[m], x, y, f);
          }));
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          if (s.design === 'A') {
            sparkles(ctx, T, 201, 22, ['#fff1b8', '#ffffff', '#ffb3d9'], {x: 0, y: 0, w: W, h: H}, [14, 40]);
            floatGlow(ctx, T, 31, T - 3);
          }
          // the title, every letter landed and coloured; no heart bubble
          titleFancy(ctx, s.title.x, s.title.y, s.title.scale, T, T - 30, {heart: false});
          if (s.tag) coverTag(ctx, s);
          ctx.restore();
        },
      },
    ],
    {dark: s.design === 'A'},
  );
};

export const Cover: React.FC<{spec: keyof typeof COVERS}> = ({spec}) => {
  const s = COVERS[spec];
  const out = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('cover'));
  useEffect(() => {
    loadAssets().then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);
  useLayoutEffect(() => {
    if (!ready || !out.current) return;
    const part = coverPart(s);
    const scene = document.createElement('canvas');
    scene.width = W;
    scene.height = H;
    const ctx = scene.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    for (const sh of part.shots) {
      if (s.T < sh.a || s.T >= sh.b) continue;
      ctx.save();
      DEADLINE.t = sh.b;
      sh.draw(ctx, s.T);
      ctx.restore();
    }
    DEADLINE.t = Infinity;
    const fx: Fx = noFx();
    for (const f of part.fx) f(s.T, fx);
    const full = document.createElement('canvas');
    full.width = W;
    full.height = H;
    new Post(full).render(scene, fx);
    out.current.getContext('2d')!.drawImage(full, (W - s.width) / 2, 0, s.width, H, 0, 0, s.width, H);
  }, [ready, s]);
  return (
    <AbsoluteFill style={{backgroundColor: '#ffffff'}}>
      <canvas ref={out} width={s.width} height={H} style={{width: '100%', height: '100%'}} />
    </AbsoluteFill>
  );
};
