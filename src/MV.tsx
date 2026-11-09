import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, Audio, Sequence, continueRender, delayRender, staticFile, useCurrentFrame} from 'remotion';
import {AUDIO_AT, AUDIO_FILE, FPS, H, SKIP, W} from './config';
import {buildTimeline} from './direction';
import {loadAssets} from './lib/assets';
import {DEADLINE} from './lib/type';
import {Fx, Post, noFx} from './lib/post';
import {Part} from './scenes/templates';

// One canvas, redrawn from scratch every frame: picture(T) is a pure function of T.

let timeline: Part | null = null;
let scene: HTMLCanvasElement | null = null;

/** Draw the frame at T into the scene canvas and run the post pass into post's canvas. */
export const drawFrame = (T: number, post: Post | null) => {
  timeline ??= buildTimeline();
  if (!scene) {
    scene = document.createElement('canvas');
    scene.width = W;
    scene.height = H;
  }
  const ctx = scene.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const active = timeline.shots
    .map((s, i) => ({s, i}))
    .filter(({s}) => T >= s.a && T < s.b)
    .sort((x, y) => (x.s.z ?? 0) - (y.s.z ?? 0) || x.i - y.i);
  lastLabels = active.map(({s}) => s.label);
  for (const {s} of active) {
    ctx.save();
    DEADLINE.t = s.b;
    s.draw(ctx, T);
    ctx.restore();
  }
  DEADLINE.t = Infinity;
  const fx: Fx = noFx();
  fx.frame = Math.round(T * FPS);
  for (const f of timeline.fx) f(T, fx);
  if (post) post.render(scene, fx);
  return fx;
};

export let lastLabels: string[] = [];

/** Camera of every active shot at T (self-check): [label, z, cam | null]. No drawing. */
export const camsAt = (T: number) => {
  timeline ??= buildTimeline();
  return timeline.shots.filter((s) => T >= s.a && T < s.b).map((s) => [s.label + (s.turn ? ' [turn]' : ''), s.z ?? 0, s.a, s.b, s.cam ? s.cam(T) : null] as const);
};

export const MV: React.FC = () => {
  const frame = useCurrentFrame();
  const T = frame / FPS + SKIP; // (v26) the video starts at T = SKIP
  const out = useRef<HTMLCanvasElement>(null);
  const post = useRef<Post | null>(null);
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('init'));

  useEffect(() => {
    loadAssets().then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);

  useLayoutEffect(() => {
    if (!ready || !out.current) return;
    post.current ??= new Post(out.current);
    drawFrame(T, post.current);
  }, [T, ready]);

  return (
    <AbsoluteFill style={{backgroundColor: '#ffffff'}}>
      <canvas ref={out} width={W} height={H} style={{width: '100%', height: '100%'}} />
      <Sequence from={Math.round((AUDIO_AT - SKIP) * FPS)}>
        <Audio src={staticFile(AUDIO_FILE)} />
      </Sequence>
    </AbsoluteFill>
  );
};
