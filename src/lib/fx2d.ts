// Reusable 2D light & atmosphere: cached glow sprites, depth-of-field particle fields,
// light pillars, haze, LED bokeh, petals. All deterministic in T.

import {H, W} from '../config';
import {rnd} from './time';

export type Ctx = CanvasRenderingContext2D;

const spriteCache = new Map<string, HTMLCanvasElement>();
const mk = (w: number, h: number) => Object.assign(document.createElement('canvas'), {width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h))});

const hexA = (hex: string, a: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};
export {hexA};

/** Soft round light. hard = 0..1 (0 very soft, 1 disc with a soft edge). */
export const bokehSprite = (color: string, hard = 0.55, ring = 0) => {
  const k = `bk|${color}|${hard}|${ring}`;
  let c = spriteCache.get(k);
  if (c) return c;
  const R = 64;
  c = mk(R * 2, R * 2);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(R, R, 0, R, R, R);
  gr.addColorStop(0, hexA(color, ring ? 0.35 : 1));
  gr.addColorStop(Math.max(0.01, hard * 0.85), hexA(color, ring ? 0.5 : 0.92));
  if (ring) gr.addColorStop(Math.max(0.02, hard * 0.92), hexA(color, 1));
  gr.addColorStop(1, hexA(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, R * 2, R * 2);
  spriteCache.set(k, c);
  return c;
};

/** Blurred copy of a canvas/image (computed once). */
const blurCache = new Map<string, HTMLCanvasElement>();
export const blurred = (key: string, src: CanvasImageSource & {width: number; height: number}, radius: number, down = 4) => {
  radius = Math.max(4, Math.round(radius / 8) * 8); // quantised so animated sizes reuse the cache
  const k = `${key}|${radius}|${down}`;
  let c = blurCache.get(k);
  if (c) return c;
  const w = Math.ceil(src.width / down);
  const h = Math.ceil(src.height / down);
  const pad = Math.ceil((radius / down) * 3);
  c = mk(w + pad * 2, h + pad * 2);
  const g = c.getContext('2d')!;
  g.filter = `blur(${radius / down}px)`;
  g.drawImage(src, pad, pad, w, h);
  g.filter = 'none';
  (c as unknown as {pad: number}).pad = pad * down;
  blurCache.set(k, c);
  return c;
};

// ---------------------------------------------------------------- particle fields

export type Layer = {n: number; size: [number, number]; blur: number; alpha: number; speed: number; drift?: number};

/** Bokeh field in three depths. cam = parallax offset (px at depth 1). */
/** (v43) pad: the field also covers this many px past every edge of the frame (same density), so a camera move
 *  applied to the field never shows an empty edge. */
export const bokehField = (ctx: Ctx, T: number, seed: number, colors: string[], layers: Layer[], cam = {x: 0, y: 0}, pad = 0) => {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  layers.forEach((L, li) => {
    for (let i = 0; i < L.n; i++) {
      const s = L.size[0] + (L.size[1] - L.size[0]) * rnd(seed + li * 7, i);
      const span = W + 2 * pad + s * 2;
      const x = ((((rnd(seed + li * 7 + 1, i) * span + T * L.speed * (0.6 + rnd(seed + li * 7 + 2, i)) + cam.x * L.speed * 0.02) % span) + span) % span) - s - pad;
      const spanY = H + 2 * pad + s * 2;
      const y = ((((rnd(seed + li * 7 + 3, i) * spanY - T * L.speed * 0.4 * (L.drift ?? 1) + cam.y * L.speed * 0.02) % spanY) + spanY) % spanY) - s - pad;
      const tw = 0.75 + 0.25 * Math.sin(T * (0.8 + rnd(seed + li * 7 + 4, i) * 1.6) + i);
      const col = colors[i % colors.length];
      ctx.globalAlpha = L.alpha * tw;
      ctx.drawImage(bokehSprite(col, L.blur), x - s, y - s, s * 2, s * 2);
    }
  });
  ctx.restore();
};

/** Large soft glow (light leak). */
export const glow = (ctx: Ctx, x: number, y: number, r: number, color: string, a: number) => {
  if (a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(color, a));
  g.addColorStop(0.4, hexA(color, a * 0.45));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
};
