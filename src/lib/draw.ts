import {H, W} from '../config';
import {Kind, cutsOf, Src, duotone, faceOf, img, lineart, silhouette, sizeOf} from './assets';
import {Member} from '../config';
import {blurred, hexA} from './fx2d';
import {GPROBE, GStyle, drawGlyph, layoutLine} from './type';
import {rnd} from './time';

export type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------- figures

export type Look = 'color' | 'silhouette' | 'duotone' | 'line';
export type FigFx = {
  shadow?: number; // soft drop shadow alpha (default 0.22 for colour)
  rim?: {color: string; a: number; r?: number}; // backlight halo
  blur?: number; // depth-of-field blur radius (px)
  alpha?: number;
};

export const source = (m: Member, k: Kind, look: Look = 'color', color = '#ffffff', dark = '#1a1030'): Src => {
  if (look === 'silhouette') return silhouette(m, k, color);
  if (look === 'duotone') return duotone(m, k, dark, color);
  if (look === 'line') return lineart(m, k, color);
  return img(m, k);
};

/** Self-check probe (only active in the check build): every figure drawn this frame, in screen px. */
export type ProbeFig = {m: Member; k: Kind; corners: [number, number][]; cuts: string[]; face: [number, number, number]; mat: number[]; rect: [number, number, number, number]; look: string; alpha: number};
export const PROBE: {on: boolean; figs: ProbeFig[]; fixes: {m: string; k: string; f: number}[]} = {on: false, figs: [], fixes: []};

const probeFig = (ctx: Ctx, m: Member, k: Kind, x: number, y: number, w: number, h: number, look = 'color', alpha = 1) => {
  if (!PROBE.on) return;
  const t = ctx.getTransform();
  const pt = (px: number, py: number): [number, number] => [t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f];
  const [fx, fy, fh] = faceOf(m, k);
  const c = pt(x + fx * w, y + fy * h);
  const hpx = fh * h * Math.hypot(t.a, t.b);
  PROBE.figs.push({m, k, corners: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)], cuts: cutsOf(m, k), face: [c[0], c[1], hpx], mat: [t.a, t.b, t.c, t.d, t.e, t.f], rect: [x, y, w, h], look, alpha: alpha * ctx.globalAlpha});
};

/** Liang-Barsky: does the segment (x0,y0)-(x1,y1) touch the frame rectangle (inset by m)? */
const segHitsFrame = (x0: number, y0: number, x1: number, y1: number, m = 2) => {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - m, W - m - x0, y0 - m, H - m - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
};

/** Pictures are cut at some borders (hands, hair, the legs of bust shots). Those borders must never
 *  show inside the frame: when one would, scale the picture up about the face until it is outside. */
/** Self-check: report picture borders that are hard cuts (hands, hair, legs) and would show inside
 *  the frame. Nothing is moved or resized here (a per-frame fix made sizes drift with the camera);
 *  layouts are fixed by hand until the probe reports nothing. */
const checkCuts = (ctx: Ctx, m: Member, k: Kind, x: number, y: number, w: number, h: number) => {
  if (!PROBE.on || ctx.canvas.width !== W) return;
  const cuts = cutsOf(m, k);
  if (!cuts.length) return;
  const t = ctx.getTransform();
  const S = (px: number, py: number): [number, number] => [t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f];
  for (const c of cuts) {
    const [a, b] = c === 'top' ? [S(x, y), S(x + w, y)] : c === 'bottom' ? [S(x, y + h), S(x + w, y + h)] : c === 'left' ? [S(x, y), S(x, y + h)] : [S(x + w, y), S(x + w, y + h)];
    if (segHitsFrame(a[0], a[1], b[0], b[1], 4)) PROBE.fixes.push({m, k: `${k}:${c}`, f: 1});
  }
};

const drawFig = (ctx: Ctx, m: Member, k: Kind, x: number, y: number, w: number, h: number, look: Look, color?: string, dark?: string, fx: FigFx = {}) => {
  checkCuts(ctx, m, k, x, y, w, h);
  probeFig(ctx, m, k, x, y, w, h, look, fx.alpha ?? 1);
  const s = source(m, k, look, color, dark);
  ctx.save();
  if (fx.alpha !== undefined) ctx.globalAlpha *= fx.alpha;
  if (fx.rim) {
    const sil = silhouette(m, k, fx.rim.color);
    const r = fx.rim.r ?? 18;
    const b = blurred(`rim_${m}_${k}_${fx.rim.color}`, sil, r * (sizeOf(sil).h / h), 4);
    const pad = (b as unknown as {pad: number}).pad * (h / sizeOf(sil).h);
    ctx.save();
    ctx.globalAlpha *= fx.rim.a;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(b, x - pad, y - pad, w + pad * 2, h + pad * 2);
    ctx.restore();
  }
  const sh = fx.shadow ?? (look === 'color' ? 0.22 : 0);
  if (sh > 0) {
    const sil = silhouette(m, k, '#2A1B3D');
    const b = blurred(`sh_${m}_${k}`, sil, 10 * (sizeOf(sil).h / h) + 8, 4);
    const pad = (b as unknown as {pad: number}).pad * (h / sizeOf(sil).h);
    ctx.save();
    ctx.globalAlpha *= sh;
    ctx.drawImage(b, x - pad + h * 0.012, y - pad + h * 0.018, w + pad * 2, h + pad * 2);
    ctx.restore();
  }
  if (fx.blur && fx.blur > 0.5) {
    const b = blurred(`dof_${m}_${k}_${look}_${color}`, s as HTMLCanvasElement, fx.blur * (sizeOf(s).h / h), 4);
    const pad = (b as unknown as {pad: number}).pad * (h / sizeOf(s).h);
    ctx.drawImage(b, x - pad, y - pad, w + pad * 2, h + pad * 2);
  } else ctx.drawImage(s, x, y, w, h);
  ctx.restore();
};

/** Figure placed by its face: face centre at (x, y), face height faceH (heads match across members). */
export const figAt = (ctx: Ctx, m: Member, k: Kind, x: number, y: number, faceH: number, look: Look = 'color', color?: string, dark?: string, fx?: FigFx) => {
  const s = source(m, k, look, color, dark);
  const {w: iw, h: ih} = sizeOf(s);
  const [fx0, fy, fh] = faceOf(m, k);
  const scale = faceH / (fh * ih);
  drawFig(ctx, m, k, x - fx0 * iw * scale, y - fy * ih * scale, iw * scale, ih * scale, look, color, dark, fx);
};

/** (v31) The bottom of a full figure drawn by figAt (its feet), in the same coordinates. */
export const figBottom = (m: Member, k: Kind, y: number, faceH: number) => {
  const [, fy, fh] = faceOf(m, k);
  return y + ((1 - fy) / fh) * faceH;
};

/** Crop centred on the face: the head (fraction fh of the image) becomes faceH px, centred at (x, y). */
export const faceShot = (ctx: Ctx, m: Member, k: Kind, x: number, y: number, faceH: number, look: Look = 'color', color?: string, dark?: string, fx?: FigFx) => {
  const s = source(m, k, look, color, dark);
  const {w: iw, h: ih} = sizeOf(s);
  const [fx0, fy, fh] = faceOf(m, k);
  const scale = faceH / (fh * ih);
  drawFig(ctx, m, k, x - fx0 * iw * scale, y - fy * ih * scale, iw * scale, ih * scale, look, color, dark, {shadow: 0, ...fx});
};

/** Plain static text (credits, names) using the glyph sprites. */
export const label = (ctx: Ctx, s: string, x: number, y: number, size: number, style: GStyle, align = 0.5, tracking = 0, alpha = 1) => {
  const ps = layoutLine(Array.from(s).map((ch) => ({ch, t: -1e9})), {size, tracking, align, weight: style.weight});
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  // decoration (bands, names, bubbles): not a lyric, so the self-check probe ignores it
  const was = GPROBE.on;
  GPROBE.on = false;
  for (const p of ps) drawGlyph(ctx, p.ch, style, p.size, p.x, p.y);
  GPROBE.on = was;
  ctx.restore();
};

// ---------------------------------------------------------------- shapes & patterns

export const heartPath = (ctx: Ctx, x: number, y: number, s: number) => {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.55, y - s * 1.05, x, y - s * 0.5);
  ctx.bezierCurveTo(x + s * 0.55, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.35);
  ctx.closePath();
};

export const star4 = (ctx: Ctx, x: number, y: number, r: number, inner = 0.18, rot = 0) => {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * inner;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
};

export const ring = (ctx: Ctx, x: number, y: number, r: number, width: number, color: string) => {
  if (r <= 0 || width <= 0) return;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
};

export const sunburst = (ctx: Ctx, cx: number, cy: number, n: number, color: string, rot = 0, len = 2600) => {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const da = Math.PI / n / 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - da) * len, cy + Math.sin(a - da) * len);
    ctx.lineTo(cx + Math.cos(a + da) * len, cy + Math.sin(a + da) * len);
    ctx.closePath();
    ctx.fill();
  }
};

export {hexA, rnd};
