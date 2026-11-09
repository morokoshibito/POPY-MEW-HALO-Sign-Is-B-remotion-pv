import {LYRIC_RASTER} from '../tuning';
// Lyric typography: styled glyph sprites (cached) + layout + entrance animations.
// Every glyph is rendered once per (style, size bucket) into an offscreen canvas with its
// outlines, hard extrusion and soft shadow already baked, then drawn as an image.

import {FONT, H, W} from '../config';
import {Tok} from './lyrics';
import {clamp, easeOutBack, easeOutCubic, lerp, rnd} from './time';

export type Ctx = CanvasRenderingContext2D;

export type GStyle = {
  fill: string | [string, string]; // flat or top->bottom gradient
  stroke?: string; // inner outline
  sw?: number; // fraction of the font size
  stroke2?: string; // outer outline
  sw2?: number;
  extrude?: {color: string; dx: number; dy: number}; // hard 3D offset, fractions of size
  shadow?: {color: string; dx: number; dy: number; blur: number}; // soft, fractions of size
  glow?: {color: string; blur: number};
  weight?: Weight;
};

/** 900 / 700 = M PLUS Rounded 1c, 400 = Yusei Magic (handwritten round, used on the stage). */
export type Weight = 900 | 700 | 400;

export type Glyph = {ch: string; t: number};

export const glyphs = (toks: Tok[]): Glyph[] => {
  const out: Glyph[] = [];
  for (const t of toks) for (const ch of Array.from(t.s)) out.push({ch, t: t.t0});
  return out;
};

/** Latest time a glyph may appear in the shot being drawn (set by MV per shot). */
export const DEADLINE = {t: Infinity};
export const due = (t: number) => Math.min(t, DEADLINE.t - 0.12);

// ---------------------------------------------------------------- sprites

const cache = new Map<string, {c: HTMLCanvasElement; ox: number; oy: number; w: number}>();
let cachePixels = 0;
const measureCtx = () => {
  const c = document.createElement('canvas');
  return c.getContext('2d')!;
};
let mctx: Ctx | null = null;

const font = (size: number, weight: Weight = 900) => (weight === 400 ? `400 ${size}px "YUSEI", sans-serif` : `${weight} ${size}px ${weight === 700 ? '"MPR7"' : FONT}, sans-serif`);

export const advance = (ch: string, size: number, weight: Weight = 900) => {
  mctx ??= measureCtx();
  mctx.font = font(size, weight);
  return mctx.measureText(ch).width;
};

const key = (ch: string, st: GStyle, size: number) => `${ch}|${size}|${JSON.stringify(st)}`;

/** (v20, user: B "still not clean - don't cut holes at all"; は, お, ま "don't cut the holes either") Outlined
 *  letters are stickers: no holes. v19's punched holes in B are gone, and the counters that the outline
 *  leaves open (the small left-over holes in the loops of は, お, ま, ...) are filled with the colour of the
 *  layer around them, on every layer (extrusion and shadow too, so nothing shows through). Letters without
 *  an outline keep their counters. Returns the hole mask (white), or null when the glyph has none. */
const holesOf = (ch: string, b: number, weight: Weight, wFrac: number, cx: number, cy: number, W: number, H: number): HTMLCanvasElement | null => {
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const mg = m.getContext('2d')!;
  mg.font = font(b, weight);
  mg.textAlign = 'center';
  mg.textBaseline = 'middle';
  mg.lineJoin = 'round';
  mg.miterLimit = 2;
  mg.lineWidth = wFrac * b * 2;
  mg.strokeText(ch, cx, cy);
  mg.fillText(ch, cx, cy);
  const d = mg.getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ink[i] = d[i * 4 + 3] > 96 ? 1 : 0;
  // the outside: flood fill from the border through empty pixels; whatever empty is left is a hole
  const out = new Uint8Array(W * H);
  const st: number[] = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const p = st.pop()!;
    if (out[p] || ink[p]) continue;
    out[p] = 1;
    const x = p % W;
    if (x > 0) st.push(p - 1);
    if (x < W - 1) st.push(p + 1);
    if (p >= W) st.push(p - W);
    if (p < W * (H - 1)) st.push(p + W);
  }
  let hole = new Uint8Array(W * H);
  let n = 0;
  for (let i = 0; i < W * H; i++) if (!ink[i] && !out[i]) (hole[i] = 1), n++;
  if (!n) return null;
  // grown by 2 px into the ring around it (same colour), so no anti-aliased seam is left
  for (let r = 0; r < 2; r++) {
    const h2 = hole.slice();
    for (let p = 0; p < W * H; p++) {
      if (hole[p]) continue;
      const x = p % W;
      if ((x > 0 && hole[p - 1]) || (x < W - 1 && hole[p + 1]) || (p >= W && hole[p - W]) || (p < W * (H - 1) && hole[p + W])) h2[p] = 1;
    }
    hole = h2;
  }
  const img = mg.createImageData(W, H);
  for (let i = 0; i < W * H; i++) if (hole[i]) img.data.set([255, 255, 255, 255], i * 4);
  mg.clearRect(0, 0, W, H);
  mg.putImageData(img, 0, 0);
  return m;
};

/** The hole mask in one colour. */
const tint = (mask: HTMLCanvasElement, color: string) => {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const g = c.getContext('2d')!;
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
};

/** Sprite of one glyph; (ox, oy) = position of the glyph centre inside the sprite. */
export const sprite = (ch: string, st: GStyle, size: number) => {
  const b = Math.max(8, Math.round(size / 8) * 8); // size bucket
  const k = key(ch, st, b);
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k); cache.set(k, hit); // LRU: retain the glyphs actually used in this shot.
    return {...hit, scale: size / b};
  }
  const pad = Math.ceil(b * (0.25 + (st.sw2 ?? 0) + (st.sw ?? 0) + Math.max(Math.abs(st.extrude?.dx ?? 0), Math.abs(st.extrude?.dy ?? 0)) + (st.shadow ? st.shadow.blur * 2 + Math.abs(st.shadow.dy) : 0) + (st.glow ? st.glow.blur * 2 : 0)));
  const w0 = advance(ch, b, st.weight ?? 900);
  const W = Math.ceil(w0 + pad * 2);
  const H = Math.ceil(b * 1.3 + pad * 2);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.font = font(b, st.weight ?? 900);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const cx = W / 2;
  const cy = H / 2 + b * 0.04;
  const outline = (x: number, y: number, color: string, wFrac: number) => {
    g.strokeStyle = color;
    g.lineWidth = wFrac * b * 2;
    g.strokeText(ch, x, y);
  };
  // the outermost outline is the sticker's edge: its holes are filled on every layer
  const edgeW = st.stroke2 && st.sw2 ? st.sw2 : st.stroke && st.sw ? st.sw : 0;
  const holes = edgeW ? holesOf(ch, b, st.weight ?? 900, edgeW, cx, cy, W, H) : null;
  const tints = new Map<string, HTMLCanvasElement>();
  const plug = (x: number, y: number, color: string) => {
    if (!holes) return;
    if (!tints.has(color)) tints.set(color, tint(holes, color));
    g.drawImage(tints.get(color)!, x - cx, y - cy);
  };
  const body = (x: number, y: number, color: string) => {
    g.fillStyle = color;
    g.fillText(ch, x, y);
    if (st.stroke2 && st.sw2) outline(x, y, color, st.sw2);
    else if (st.stroke && st.sw) outline(x, y, color, st.sw);
    plug(x, y, color);
  };
  if (st.glow) {
    g.save();
    g.filter = `blur(${st.glow.blur * b}px)`;
    body(cx, cy, st.glow.color);
    g.restore();
  }
  if (st.shadow) {
    g.save();
    g.filter = `blur(${st.shadow.blur * b}px)`;
    body(cx + st.shadow.dx * b, cy + st.shadow.dy * b, st.shadow.color);
    g.restore();
  }
  if (st.extrude) {
    const n = Math.max(2, Math.round(Math.hypot(st.extrude.dx, st.extrude.dy) * b / 1.5));
    for (let i = n; i >= 1; i--) body(cx + (st.extrude.dx * b * i) / n, cy + (st.extrude.dy * b * i) / n, st.extrude.color);
  }
  // the holes in the colour of the outermost outline (the ring around them), under the inner outline
  if (st.stroke2 && st.sw2) {
    outline(cx, cy, st.stroke2, st.sw2);
    plug(cx, cy, st.stroke2);
  }
  if (st.stroke && st.sw) {
    outline(cx, cy, st.stroke, st.sw);
    if (!(st.stroke2 && st.sw2)) plug(cx, cy, st.stroke);
  }
  if (Array.isArray(st.fill)) {
    const gr = g.createLinearGradient(0, cy - b * 0.5, 0, cy + b * 0.5);
    gr.addColorStop(0, st.fill[0]);
    gr.addColorStop(1, st.fill[1]);
    g.fillStyle = gr;
  } else g.fillStyle = st.fill;
  g.fillText(ch, cx, cy);
  const v = {c, ox: cx, oy: cy, w: w0};
  while (cache.size && cachePixels + W * H > LYRIC_RASTER.cacheMegapixels * 1e6) {
    const first = cache.keys().next().value!;
    const old = cache.get(first)!; cachePixels -= old.c.width * old.c.height; cache.delete(first);
  }
  cache.set(k, v);
  cachePixels += W * H;
  return {...v, scale: size / b};
};

/** Self-check probe: every glyph drawn this frame (screen centre, on-screen size, alpha). */
export const GPROBE: {on: boolean; gs: {ch: string; x: number; y: number; size: number; a: number}[]} = {on: false, gs: []};

export const drawGlyph = (ctx: Ctx, ch: string, st: GStyle, size: number, x: number, y: number, rot = 0, scale = 1, alpha = 1) => {
  if (alpha <= 0.002 || scale <= 0.002 || !ch.trim()) return;
  if (GPROBE.on) {
    const t = ctx.getTransform();
    GPROBE.gs.push({ch, x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f, size: size * scale * Math.hypot(t.a, t.b), a: alpha * ctx.globalAlpha});
  }
  const m = ctx.getTransform();
  // Largest singular value includes camera zoom, glyph stretch, and parent transforms.
  const trace = m.a*m.a + m.b*m.b + m.c*m.c + m.d*m.d;
  const det = m.a*m.d - m.b*m.c;
  const screenScale = Math.sqrt((trace + Math.sqrt(Math.max(0, trace*trace - 4*det*det))) / 2) * scale;
  const desired = Math.max(1, screenScale * LYRIC_RASTER.supersample);
  const density = Math.max(1, Math.min(LYRIC_RASTER.maxDensity, 2 ** Math.ceil(Math.log2(desired)), LYRIC_RASTER.maxFontPixels / size));
  const s = sprite(ch, st, size * density);
  const k = s.scale * scale / density;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha *= Math.min(1, alpha);
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(s.c, -s.ox * k, -s.oy * k, s.c.width * k, s.c.height * k);
  ctx.restore();
};

// ---------------------------------------------------------------- layout

export type Placed = {ch: string; t: number; x: number; y: number; size: number; rot: number; i: number};

export type LayoutOpts = {
  size: number;
  tracking?: number; // extra px between glyphs (fraction of size)
  align?: number; // 0 left, 0.5 centre, 1 right
  wave?: {amp: number; len: number; phase?: number}; // baseline wave (px, px)
  sizeJitter?: number; // +- fraction
  rotJitter?: number; // +- radians
  yJitter?: number; // +- px
  seed?: number;
  smallKana?: number; // scale for small kana / punctuation (default 0.8)
  weight?: Weight;
};

const SMALL = 'ゃゅょっぁぃぅぇぉャュョッァィゥェォ、。・';

/** Lay a run of glyphs on a line through (0,0) in local space. */
export const layoutLine = (gs: Glyph[], o: LayoutOpts): Placed[] => {
  const seed = o.seed ?? 7;
  const sizes = gs.map((g, i) => {
    let s = o.size * (1 + (o.sizeJitter ?? 0) * (rnd(seed, i) * 2 - 1));
    if (SMALL.includes(g.ch)) s *= o.smallKana ?? 0.8;
    return s;
  });
  const adv = gs.map((g, i) => (g.ch === '　' ? sizes[i] * 0.45 : advance(g.ch, sizes[i], o.weight)) + (o.tracking ?? 0) * o.size);
  const total = adv.reduce((a, b) => a + b, 0);
  let x = -total * (o.align ?? 0.5);
  return gs.map((g, i) => {
    const cx = x + adv[i] / 2;
    x += adv[i];
    const wave = o.wave ? o.wave.amp * Math.sin((cx / o.wave.len) * Math.PI * 2 + (o.wave.phase ?? 0)) : 0;
    return {
      ch: g.ch,
      t: g.t,
      x: cx,
      y: wave + (o.yJitter ?? 0) * (rnd(seed + 3, i) * 2 - 1),
      size: sizes[i],
      rot: (o.rotJitter ?? 0) * (rnd(seed + 5, i) * 2 - 1),
      i,
    };
  });
};

// ---------------------------------------------------------------- animation

export type Enter =
  | {kind: 'flow'; lead?: number; dist?: number; angle?: number; s0?: number; spin?: number} // glide in along the line, growing (spin: radians turned on the way in)
  | {kind: 'drop'; lead?: number; dist?: number} // fall into place
  | {kind: 'pop'; lead?: number} // scale up with overshoot in place
  | {kind: 'whole'; at: number; dur?: number; from?: number} // all at once
  | {kind: 'fly'; at: number; step?: number; dur?: number; seed?: number; dist?: number} // each glyph flies in on its own path (direction, spin, scale), springs into place
  | {kind: 'cascade'; at: number; step?: number; dur?: number; drop?: number; spin?: number} // whole line, glyphs a few frames apart (not tied to the voice)
  | {kind: 'slam'; lead?: number}; // big -> small

export type Exit = {at: number; dur?: number; dx?: number; dy?: number; scale?: number};

export type StyleOf = GStyle | ((p: Placed) => GStyle);

/** Draw placed glyphs in a local frame (caller sets the transform). */
/** Keep a block of lyrics inside the frame: if the final layout (in screen space) leaves the frame
 *  minus a margin, scale it about its centre and shift it inside. Stable over time (uses the final
 *  positions, not the animated ones). Returns true when it changed the transform. */
export const GUARD = {margin: 36, active: false};
export const guardFrame = (ctx: Ctx, ps: Placed[]) => {
  if (!ps.length) return false;
  const t = ctx.getTransform();
  const sc = Math.hypot(t.a, t.b);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ps) {
    const sx = t.a * p.x + t.c * p.y + t.e;
    const sy = t.b * p.x + t.d * p.y + t.f;
    const r = p.size * 0.56 * sc;
    x0 = Math.min(x0, sx - r);
    x1 = Math.max(x1, sx + r);
    y0 = Math.min(y0, sy - r);
    y1 = Math.max(y1, sy + r);
  }
  const m = GUARD.margin;
  const bw = x1 - x0;
  const bh = y1 - y0;
  const s = Math.min(1, (W - 2 * m) / bw, (H - 2 * m) / bh);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const nw = bw * s;
  const nh = bh * s;
  const ncx = Math.min(Math.max(cx, m + nw / 2), W - m - nw / 2);
  const ncy = Math.min(Math.max(cy, m + nh / 2), H - m - nh / 2);
  if (s > 0.999 && Math.abs(ncx - cx) < 0.5 && Math.abs(ncy - cy) < 0.5) return false;
  // screen fix F = translate(ncx, ncy) * scale(s) * translate(-cx, -cy); new = F * t
  const f = new DOMMatrix().translate(ncx, ncy).scale(s, s).translate(-cx, -cy);
  ctx.setTransform(f.multiply(t));
  return true;
};

export const drawPlaced = (ctx: Ctx, ps: Placed[], T: number, style: StyleOf, enter: Enter, exit?: Exit, extra?: (p: Placed, k: number) => void) => {
  if (!GUARD.active) {
    ctx.save();
    GUARD.active = true;
    guardFrame(ctx, ps);
    try {
      drawPlaced(ctx, ps, T, style, enter, exit, extra);
    } finally {
      GUARD.active = false;
      ctx.restore();
    }
    return;
  }
  const ex = exit ? clamp((T - exit.at) / (exit.dur ?? 0.18)) : 0;
  if (ex >= 1) return;
  for (const p of ps) {
    const st = typeof style === 'function' ? style(p) : style;
    let x = p.x;
    let y = p.y;
    let s = 1;
    let a = 1;
    let r = p.rot;
    let k = 1;
    if (enter.kind === 'whole') {
      const d = enter.dur ?? 0.16;
      k = clamp((T - enter.at) / d);
      if (k <= 0) continue;
      const e = easeOutCubic(k);
      s = lerp(enter.from ?? 1.25, 1, e);
      a = clamp(k * 2);
    } else if (enter.kind === 'fly') {
      const d = enter.dur ?? 0.42;
      const t = T - (enter.at + p.i * (enter.step ?? 0.055));
      k = clamp(t / d);
      if (t <= 0) continue;
      const sd = (enter.seed ?? 1) * 31 + p.i * 7;
      const ang = -Math.PI / 2 + (rnd(sd, 1) - 0.5) * 2.6; // mostly from below, fanning to the sides
      const dist = (enter.dist ?? 1.3) * p.size * (0.7 + rnd(sd, 2) * 0.6);
      // damped spring for position, rotation and scale: overshoots once, settles
      const sp = t <= 0 ? 0 : 1 - Math.exp(-9 * t) * Math.cos(16 * t);
      const off = 1 - sp;
      x -= Math.cos(ang) * dist * off;
      y -= Math.sin(ang) * dist * off;
      r += (rnd(sd, 3) - 0.5) * 1.6 * off;
      s = 1 + ((rnd(sd, 4) < 0.5 ? 0.25 : 2.1) - 1) * off;
      a = clamp(t / 0.08);
    } else if (enter.kind === 'cascade') {
      const d = enter.dur ?? 0.22;
      k = clamp((T - (enter.at + p.i * (enter.step ?? 0.035))) / d);
      if (k <= 0) continue;
      s = easeOutBack(k, 2.0);
      y -= (enter.drop ?? 0.35) * p.size * (1 - easeOutCubic(k));
      r += (enter.spin ?? 0) * (1 - easeOutCubic(k));
      a = clamp(k * 3);
    } else {
      const t = due(p.t);
      if (enter.kind === 'flow') {
        const L = enter.lead ?? 0.24;
        k = clamp((T - (t - L)) / L);
        if (k <= 0) continue;
        const e = easeOutCubic(k);
        const ang = enter.angle ?? 0;
        const D = (enter.dist ?? 1.6) * p.size * (1 - e);
        x += Math.cos(ang) * D;
        y += Math.sin(ang) * D;
        r += (enter.spin ?? 0) * (1 - e);
        s = lerp(enter.s0 ?? 0.15, 1, e);
        a = clamp(k * 3);
      } else if (enter.kind === 'drop') {
        const L = enter.lead ?? 0.16;
        k = clamp((T - (t - L)) / L);
        if (k <= 0) continue;
        y -= (enter.dist ?? 0.6) * p.size * (1 - easeOutBack(k, 2.2));
        a = clamp(k * 3);
      } else if (enter.kind === 'pop') {
        const L = enter.lead ?? 0.14;
        k = clamp((T - (t - L)) / L);
        if (k <= 0) continue;
        s = easeOutBack(k, 2.6);
        a = clamp(k * 3);
      } else {
        const L = enter.lead ?? 0.12;
        k = clamp((T - (t - L)) / L);
        if (k <= 0) continue;
        s = lerp(2.2, 1, easeOutCubic(k));
        a = clamp(k * 2.5);
      }
    }
    if (ex > 0) {
      const e = easeOutCubic(ex);
      x += (exit!.dx ?? 0) * e;
      y += (exit!.dy ?? 0) * e;
      s *= lerp(1, exit!.scale ?? 1, e);
      a *= 1 - ex;
    }
    extra?.(p, k);
    drawGlyph(ctx, p.ch, st, p.size, x, y, r, s, a);
  }
};
