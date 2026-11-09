// Self-check compositions (not part of the MV; only used by scripts/check.mjs).
//  Probe: runs the timeline every `dt` seconds with the probes on and logs, per frame, the active
//         shots, the figures (screen corners, cut borders), the cut-border fixes and the glyph boxes.
//  Sheet: draws `n` frames from t0 every dt into one contact sheet (post pass included).
import React, {useEffect, useRef, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {DURATION, H, W} from './config';
import {camsAt, drawFrame, lastLabels} from './MV';
import {Kind, faceOf, img, loadAssets, sizeOf} from './lib/assets';
import {Member} from './config';
import {PROBE} from './lib/draw';
import {Post} from './lib/post';
import {GPROBE} from './lib/type';

// alpha maps of the pictures (for "is this face covered by that figure?")
const alphaMaps = new Map<string, {w: number; h: number; a: Uint8ClampedArray}>();
const alphaOf = (m: Member, k: Kind) => {
  const key = `${m}_${k}`;
  let hit = alphaMaps.get(key);
  if (!hit) {
    const src = img(m, k);
    const {w: iw, h: ih} = sizeOf(src);
    const w = 128;
    const h = Math.max(1, Math.round((128 * ih) / iw));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.drawImage(src as CanvasImageSource, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const a = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3];
    hit = {w, h, a};
    alphaMaps.set(key, hit);
  }
  return hit;
};
/** Fraction of each visible face covered by a figure drawn after it: [[back member, front member, fraction]]. */
const occlusions = () => {
  const out: [string, string, number][] = [];
  const figs = PROBE.figs.filter((f) => f.alpha > 0.5 && f.look !== 'line');
  figs.forEach((b, i) => {
    if (b.look !== 'color') return;
    const [cx, cy, h] = b.face;
    if (cx < -h || cx > W + h || cy < -h || cy > H + h || h < 20) return;
    const pts: [number, number][] = [[cx, cy]];
    for (let q = 0; q < 8; q++) pts.push([cx + Math.cos((q * Math.PI) / 4) * h * 0.32, cy + Math.sin((q * Math.PI) / 4) * h * 0.32]);
    for (const f of figs.slice(i + 1)) {
      if (f.m === b.m && Math.abs(f.face[0] - cx) < 5) continue;
      const [a, bb, c, d, e, ff] = f.mat;
      const det = a * d - bb * c;
      const am = alphaOf(f.m, f.k);
      let hit = 0;
      for (const [px, py] of pts) {
        const lx = (d * (px - e) - c * (py - ff)) / det;
        const ly = (-bb * (px - e) + a * (py - ff)) / det;
        const u = (lx - f.rect[0]) / f.rect[2];
        const v = (ly - f.rect[1]) / f.rect[3];
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        if (am.a[Math.floor(v * am.h) * am.w + Math.floor(u * am.w)] > 128) hit++;
      }
      if (hit >= 2) out.push([b.m, f.m, Math.round((hit / pts.length) * 100) / 100]);
    }
  });
  return out;
};

export const Probe: React.FC<{t0?: number; t1?: number; dt?: number; cams?: boolean}> = ({t0 = 0, t1 = DURATION, dt = 0.1, cams = false}) => {
  const [handle] = useState(() => delayRender('probe', {timeoutInMilliseconds: 1_800_000}));
  useEffect(() => {
    loadAssets().then(() => {
      if (cams) {
        // camera log only (fast): every frame, every active shot's declared camera
        for (let i = Math.round(t0 * 30); i < t1 * 30; i++) {
          const T = i / 30;
          console.log('C|' + JSON.stringify({T: Math.round(T * 1000) / 1000, s: camsAt(T).map(([l, z, a, b, c]) => [l, z, Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000, c && [c.x, c.y, c.z, c.r].map((v) => Math.round(v * 1e6) / 1e6)])}));
        }
        console.log('C|DONE');
        continueRender(handle);
        return;
      }
      PROBE.on = true;
      GPROBE.on = true;
      for (let T = t0; T < t1; T += dt) {
        PROBE.figs = [];
        PROBE.fixes = [];
        GPROBE.gs = [];
        drawFrame(T, null);
        const r = (v: number) => Math.round(v);
        console.log(
          'P|' +
            JSON.stringify({
              T: Math.round(T * 1000) / 1000,
              shots: lastLabels,
              figs: PROBE.figs.map((f) => ({m: f.m, k: f.k, c: f.corners.map(([x, y]) => [r(x), r(y)]), cuts: f.cuts, face: f.face.map(r), look: f.look, al: Math.round(f.alpha * 100) / 100})),
              occl: occlusions(),
              fixes: PROBE.fixes,
              gs: GPROBE.gs.filter((g) => g.a > 0.3).map((g) => [g.ch, r(g.x), r(g.y), r(g.size), Math.round(g.a * 100) / 100]),
            }),
        );
      }
      console.log('P|DONE');
      continueRender(handle);
    });
  }, [handle, t0, t1, dt, cams]);
  return <AbsoluteFill style={{backgroundColor: '#000'}} />;
};

// ---------------------------------------------------------------- exposure probe
// For each time: the final image (post pass included) is read back and every face drawn in colour is
// compared with the same face in the source picture: mean lightness, the dark end (5th percentile: line art
// and pupils; a lift here is the washed-out look), the share of clipped pixels and the saturation.
type FaceStats = {L: number; p5: number; clip: number; sat: number; n: number};
const statsOf = (get: (u: number, v: number) => [number, number, number, number] | null): FaceStats => {
  const Ls: number[] = [];
  let sat = 0;
  for (let j = 0; j < 36; j++)
    for (let i = 0; i < 36; i++) {
      const u = (i + 0.5) / 36 * 2 - 1;
      const v = (j + 0.5) / 36 * 2 - 1;
      if (u * u + v * v > 1) continue;
      const px = get(u, v);
      if (!px || px[3] < 200) continue;
      const [r, g, b] = px.map((x) => x / 255);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      Ls.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      sat += mx > 0 ? (mx - mn) / mx : 0;
    }
  Ls.sort((a, b) => a - b);
  const n = Ls.length;
  if (!n) return {L: 0, p5: 0, clip: 0, sat: 0, n: 0};
  return {L: Ls.reduce((a, b) => a + b, 0) / n, p5: Ls[Math.floor(n * 0.05)], clip: Ls.filter((x) => x > 0.985).length / n, sat: sat / n, n};
};
const srcStats = new Map<string, FaceStats>();
// the source face is resampled to the size it has on screen first (a small face loses its fine dark lines
// to resampling, not to the light)
const sourceFace = (m: Member, k: Kind, hpOut: number): FaceStats => {
  const hq = Math.max(40, Math.round(hpOut / 20) * 20);
  const key = `${m}_${k}_${hq}`;
  const hit = srcStats.get(key);
  if (hit) return hit;
  const src = img(m, k);
  const {w: w0, h: h0} = sizeOf(src);
  const [fx, fy, fh] = faceOf(m, k);
  const sc = Math.min(1, hq / (fh * h0));
  const w = Math.max(1, Math.round(w0 * sc));
  const h = Math.max(1, Math.round(h0 * sc));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src as CanvasImageSource, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const hp = fh * h;
  const st = statsOf((u, v) => {
    const x = Math.round(fx * w + u * hp * 0.36);
    const y = Math.round(fy * h + v * hp * 0.42);
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const o = (y * w + x) * 4;
    return [d[o], d[o + 1], d[o + 2], d[o + 3]];
  });
  srcStats.set(key, st);
  return st;
};

export const Expo: React.FC<{times: number[]}> = ({times}) => {
  const [handle] = useState(() => delayRender('expo', {timeoutInMilliseconds: 1_800_000}));
  useEffect(() => {
    loadAssets().then(() => {
      const pc = document.createElement('canvas');
      pc.width = W;
      pc.height = H;
      const post = new Post(pc);
      const rd = document.createElement('canvas');
      rd.width = W;
      rd.height = H;
      const rg = rd.getContext('2d', {willReadFrequently: true})!;
      for (const T of times) {
        PROBE.on = true;
        PROBE.figs = [];
        PROBE.fixes = [];
        drawFrame(T, post);
        rg.drawImage(pc, 0, 0);
        const d = rg.getImageData(0, 0, W, H).data;
        const seen = new Set<string>();
        for (const f of PROBE.figs) {
          if (f.look !== 'color' || f.alpha < 0.9) continue;
          const [cx, cy, hp] = f.face;
          if (hp < 40 || cx < hp * 0.4 || cy < hp * 0.4 || cx > W - hp * 0.4 || cy > H - hp * 0.4) continue;
          const key = `${f.m}_${Math.round(cx / 20)}_${Math.round(cy / 20)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const r = statsOf((u, v) => {
            const x = Math.round(cx + u * hp * 0.36);
            const y = Math.round(cy + v * hp * 0.42);
            if (x < 0 || y < 0 || x >= W || y >= H) return null;
            const o = (y * W + x) * 4;
            return [d[o], d[o + 1], d[o + 2], 255];
          });
          const s = sourceFace(f.m, f.k, hp);
          const q = (v: number) => Math.round(v * 1000) / 1000;
          console.log('E|' + JSON.stringify({T, shots: lastLabels, m: f.m, k: f.k, hp: Math.round(hp), r: [q(r.L), q(r.p5), q(r.clip), q(r.sat)], s: [q(s.L), q(s.p5), q(s.clip), q(s.sat)]}));
        }
      }
      PROBE.on = false;
      console.log('E|DONE');
      continueRender(handle);
    });
  }, [handle, times]);
  return <AbsoluteFill style={{backgroundColor: '#000'}} />;
};

export const Sheet: React.FC<{t0: number; dt: number; n: number; cols?: number}> = ({t0, dt, n, cols = 6}) => {
  const out = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender('sheet', {timeoutInMilliseconds: 1_800_000}));
  const tw = Math.floor(W / cols);
  const th = Math.floor((tw * H) / W);
  const rows = Math.ceil(n / cols);
  useEffect(() => {
    loadAssets().then(() => {
      const c = out.current!;
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, c.height);
      const pc = document.createElement('canvas');
      pc.width = W;
      pc.height = H;
      const post = new Post(pc);
      for (let i = 0; i < n; i++) {
        const T = t0 + i * dt;
        drawFrame(T, post);
        const x = (i % cols) * tw;
        const y = Math.floor(i / cols) * th;
        g.drawImage(pc, x, y, tw - 2, th - 2);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(x, y, 74, 20);
        g.fillStyle = '#ffeb3b';
        g.font = '14px monospace';
        g.fillText(T.toFixed(2), x + 4, y + 15);
      }
      continueRender(handle);
    });
  }, [handle, t0, dt, n, cols, tw, th]);
  return <canvas ref={out} width={W} height={rows * th} style={{width: '100%'}} />;
};
