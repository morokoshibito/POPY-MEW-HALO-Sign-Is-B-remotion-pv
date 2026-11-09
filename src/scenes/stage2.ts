import {B_PULLBACK, BAKURES, PHOTO_IN, SAIRIUM, SOLO_PARTICLES, STAGE_LIGHT} from '../tuning';
// Stage sections after the second reference, driven by camera rigs whose timings, directions and
// speeds come from the frame-by-frame measurement of the reference (docs/ref2_shotlist.md).
// A shot = scene (stage picture + members + foreground penlights) seen through a rig; text is drawn
// in screen space. Motion blur comes from the rig speed. Whip-pans are an outgoing acceleration plus
// an incoming deceleration in the same direction.
import {COLORS, H, Member, W} from '../config';
import {Kind, bgImage} from '../lib/assets';
import {drawBlurred, gpuBlur, layer} from '../lib/blur';
import {Ctx, figAt, figBottom, star4} from '../lib/draw';
import {drawFancy} from '../lib/fancy';
import {bokehField, glow, hexA} from '../lib/fx2d';
import {Seg} from '../lib/lyrics';
import {Fx} from '../lib/post';
import {Cam, Key, Rig, flow, glide, intoCut, rigBlur, view} from '../lib/rig';
import {BEAT, clamp, easeInOut, easeOutCubic, lerp, prog, rnd} from '../lib/time';
import {GStyle, Glyph, Placed, drawGlyph, glyphs, guardFrame, layoutLine} from '../lib/type';
import {layoutVert, lensFlare, loveBubbles} from './popkit';
import {Part, Shot, flashAt, grade} from './templates';

const ORDER: Member[] = ['mew', 'popy', 'halo'];
const RED_H = '#ff5a8a';
const noSpace = (gs: Glyph[]) => gs.filter((g) => g.ch !== '　' && g.ch !== ' ');

// ---------------------------------------------------------------- lettering (handwritten round, like the reference)

/** Giant phrase text: white, soft pink-orange glow (Yusei Magic). */
export const BIG: GStyle = {fill: '#ffffff', weight: 400, glow: {color: '#ffc2a8', blur: 0.05}, shadow: {color: '#ff4f9add', dx: 0, dy: 0, blur: 0.2}};
/** Solo subtitles on the white ground: peach letters with a warm glow (as the reference). */
export const SOLOSUB: GStyle = {fill: ['#ff9a5c', '#f2557d'], weight: 400, stroke: '#ffffff', sw: 0.06, shadow: {color: '#ff8a6acc', dx: 0, dy: 0, blur: 0.2}};
export const SUBT: GStyle = {fill: '#ffffff', weight: 400, stroke: '#e0307e', sw: 0.05, glow: {color: '#ffb6d9', blur: 0.06}, shadow: {color: '#8a0f50ee', dx: 0, dy: 0.02, blur: 0.22}};
/** Credits on the light stage: white with a deeper pink halo for contrast. */
const CREDIT: GStyle = {fill: '#ffffff', weight: 400, stroke: '#c2187a', sw: 0.05, shadow: {color: '#8a0f5aee', dx: 0, dy: 0.04, blur: 0.18}};

/** Split the glyphs of some segments into chunks given as strings (spaces ignored). */
export const chunk = (segs: Seg[], texts: string[]) => {
  const all = noSpace(segs.flatMap((sg) => glyphs(sg.toks)));
  let i0 = 0;
  return texts.map((tx) => {
    const chars = Array.from(tx);
    const n = chars.filter((ch) => ch !== ' ' && ch !== '\u3000').length;
    const src = all.slice(i0, i0 + n);
    i0 += n;
    // keep the spaces of the chunk text as space glyphs (layout gap)
    const gs: Glyph[] = [];
    let k = 0;
    for (const ch of chars) {
      if (ch === ' ' || ch === '\u3000') gs.push({ch: '\u3000', t: src[Math.max(0, k - 1)]?.t ?? 0});
      else if (src[k]) gs.push(src[k++]);
    }
    return {text: tx, gs, t: src[0]?.t ?? 0};
  });
};
export type Chunk = ReturnType<typeof chunk>[number];

/** A subtitle track: each chunk appears whole (soft scale-in), stays until the next one. */
export const subtitleShot = (cs: Chunk[], a: number, b: number, o: {y?: number; size?: number; lead?: number; style?: GStyle} = {}): Shot => ({
  a,
  b,
  z: 6,
  label: 'subtitles',
  draw: (ctx, T) => {
    const lead = o.lead ?? 0.1;
    let cur = -1;
    cs.forEach((c, i) => {
      if (T >= c.t - lead) cur = i;
    });
    if (cur < 0) return;
    const c = cs[cur];
    const next = cs[cur + 1];
    const ps = layoutLine(c.gs, {size: o.size ?? 86, tracking: 0.02, weight: 400});
    ctx.save();
    ctx.translate(W / 2, o.y ?? 968);
    const exit = next ? {at: next.t - lead - 0.06, dur: 0.06} : {at: b - 0.12, dur: 0.12};
    // each glyph rises in on its own (a few frames apart) instead of the line fading in as a block
    drawFancy(ctx, ps, T, o.style ?? SUBT, {kind: 'fly', at: c.t - lead, step: 0.022, dist: 0.5, seed: cur * 13 + 5}, {sparkle: ['#ffffff', '#ffd1e6']}, exit);
    ctx.restore();
  },
});

// ---------------------------------------------------------------- the stage picture

const picCache = new Map<string, HTMLCanvasElement>();

/** 2D stage after the reference: lavender haze, LED screen, trusses, bulb row, glowing step rows, lasers.
 *  A user picture in public/bg/stage_pink.* replaces it. 2880x1620 for pan and zoom headroom.
 *  (v15, user: fast pull backs showed the edge of the stage) the procedural stage is now twice as wide and
 *  twice as tall around the same centre: the venue goes on (more trusses, side screens, the upper rig, the
 *  steps run on toward the camera), stored at half resolution (it is always drawn out of focus). `ext` = how
 *  many screens-worth bigger than before the picture is (drawStage scales by it). */
/** (v20, user: in the pre-show the stage was only dimmed while its lights kept sweeping) `off`: the same stage
 *  with every light source off - no lamps, bulbs, LED screens, step lights, lasers or spot heads; only the
 *  structure, faintly. */
const stagePicture = (dark: boolean, off = false): CanvasImageSource & {width: number; height: number; ext?: number} => {
  const user = bgImage('stage_pink');
  const key = `${dark}|${off}|${user ? 'u' : 'p'}`;
  const hit = picCache.get(key);
  if (hit) return hit;
  const PW = 2880;
  const PH = 1620;
  const c = document.createElement('canvas') as HTMLCanvasElement & {ext?: number};
  c.width = PW;
  c.height = PH;
  const g = c.getContext('2d')!;
  if (user) {
    const s = Math.max(PW / user.width, PH / user.height);
    g.drawImage(user, (PW - user.width * s) / 2, (PH - user.height * s) / 2, user.width * s, user.height * s);
    if (off) {
      g.fillStyle = 'rgba(8,4,14,0.9)';
      g.fillRect(0, 0, PW, PH);
    }
  } else {
    c.ext = 2;
    // the old 2880 x 1620 coordinates, now the centre quarter of the canvas; the drawing runs on over
    // x -1440..4320, y -810..2430
    g.scale(0.5, 0.5);
    g.translate(PW / 2, PH / 2);
    const X0 = -PW / 2;
    const X1 = PW * 1.5;
    const Y0 = -PH / 2;
    const Y1 = PH * 1.5;
    const bgG = g.createLinearGradient(0, Y0, 0, PH);
    // off: no light on the back wall; the stage floor a shade lighter (the crowd's penlights reach it)
    bgG.addColorStop(0, off ? '#08050d' : '#5b3a86');
    bgG.addColorStop(0.2, off ? '#0d0816' : '#c9a2e6');
    bgG.addColorStop((PH / 2) / (PH * 1.5), off ? '#140c20' : '#fbe6f4');
    bgG.addColorStop((PH / 2 + PH * 0.3) / (PH * 1.5), off ? '#1a0f26' : '#e3a9de');
    bgG.addColorStop((PH / 2 + PH * 0.62) / (PH * 1.5), off ? '#1c1028' : '#b06ab8');
    bgG.addColorStop(1, off ? '#1a0e24' : '#7a3a86');
    g.fillStyle = bgG;
    g.fillRect(X0, Y0, X1 - X0, PH - Y0);
    g.fillStyle = off ? '#1a0e24' : '#7a3a86';
    g.fillRect(X0, PH, X1 - X0, Y1 - PH);
    const steelOff = '#2a2140';
    // the upper rig: a truss across the top with a row of moving-head lamps
    g.fillStyle = off ? steelOff : '#3d2f5c';
    g.fillRect(X0, -330, X1 - X0, 34);
    g.fillRect(X0, -250, X1 - X0, 14);
    for (let x = X0 + 80; x < X1 && !off; x += 240) {
      const gg = g.createRadialGradient(x, -240, 0, x, -240, 120);
      gg.addColorStop(0, 'rgba(255,255,255,0.95)');
      gg.addColorStop(0.35, 'rgba(255,225,250,0.6)');
      gg.addColorStop(1, 'rgba(255,200,255,0)');
      g.fillStyle = gg;
      g.fillRect(x - 120, -360, 240, 240);
    }
    // side LED screens
    for (const sx2 of [-1180, PW + 360]) {
      const scr2 = g.createLinearGradient(0, PH * 0.06, 0, PH * 0.36);
      scr2.addColorStop(0, off ? '#110c1a' : '#fff4fb');
      scr2.addColorStop(1, off ? '#0e0a16' : '#efc8ea');
      g.fillStyle = scr2;
      g.fillRect(sx2, PH * 0.08, 820, PH * 0.27);
      g.fillStyle = off ? 'rgba(60,48,90,0.25)' : 'rgba(200,170,240,0.35)';
      for (let x = sx2; x < sx2 + 820; x += 26) for (let y = PH * 0.08; y < PH * 0.35; y += 26) if (rnd(4, x * 7 + y) < 0.4) g.fillRect(x, y, 14, 14);
    }
    // LED screen (bright, soft)
    const sx = PW * 0.22;
    const sw = PW * 0.56;
    const sy = PH * 0.05;
    const sh = PH * 0.33;
    const scr = g.createLinearGradient(0, sy, 0, sy + sh);
    scr.addColorStop(0, off ? '#120d1c' : '#ffffff');
    scr.addColorStop(1, off ? '#0f0a17' : '#f6d6f2');
    g.fillStyle = scr;
    g.fillRect(sx, sy, sw, sh);
    g.fillStyle = off ? 'rgba(60,48,90,0.25)' : 'rgba(200,170,240,0.35)';
    for (let x = sx; x < sx + sw; x += 26) for (let y = sy; y < sy + sh; y += 26) if (rnd(3, x * 7 + y) < 0.4) g.fillRect(x, y, 14, 14);
    // trusses at the sides
    g.strokeStyle = off ? steelOff : '#3d2f5c';
    g.lineWidth = 9;
    for (const tx of [-PW * 0.42, -PW * 0.08, PW * 0.08, PW * 0.92, PW * 1.08, PW * 1.42]) {
      for (const dx of [-60, 60]) {
        g.beginPath();
        g.moveTo(tx + dx, -330);
        g.lineTo(tx + dx, PH * 0.75);
        g.stroke();
      }
      for (let y = -330; y < PH * 0.75; y += 120) {
        g.beginPath();
        g.moveTo(tx - 60, y);
        g.lineTo(tx + 60, y + 120);
        g.moveTo(tx - 60, y);
        g.lineTo(tx + 60, y);
        g.stroke();
      }
    }
    // horizontal truss with a bulb row
    g.fillStyle = off ? steelOff : '#4a3a6c';
    g.fillRect(X0, PH * 0.38, X1 - X0, 26);
    for (let x = X0 + 30; x < X1 && !off; x += 70) {
      const gg = g.createRadialGradient(x, PH * 0.39, 0, x, PH * 0.39, 26);
      gg.addColorStop(0, '#ffffff');
      gg.addColorStop(0.4, 'rgba(255,240,255,0.9)');
      gg.addColorStop(1, 'rgba(255,200,255,0)');
      g.fillStyle = gg;
      g.fillRect(x - 26, PH * 0.39 - 26, 52, 52);
    }
    // stairs: glowing white-pink step edges, closer = farther apart
    let y = PH * 0.45;
    let step = 34;
    while (y < Y1) {
      g.fillStyle = off ? 'rgba(6,2,10,0.42)' : 'rgba(110,40,120,0.42)';
      g.fillRect(X0, y, X1 - X0, step * 0.55);
      // off: the step nosings catch a little of the crowd's light, no LED line
      const ln = g.createLinearGradient(0, y - 8, 0, y + 8);
      ln.addColorStop(0, 'rgba(255,220,255,0)');
      ln.addColorStop(0.5, off ? 'rgba(120,90,150,0.22)' : 'rgba(255,240,255,0.95)');
      ln.addColorStop(1, 'rgba(255,220,255,0)');
      g.fillStyle = ln;
      g.fillRect(X0, y - 8, X1 - X0, 16);
      y += step;
      step = Math.min(step * 1.12, 260);
    }
    // magenta lasers
    g.save();
    if (off) g.globalAlpha = 0;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (let i = 0; i < 15; i++) {
      g.strokeStyle = i % 2 ? 'rgba(255,90,200,0.55)' : 'rgba(255,140,230,0.45)';
      g.lineWidth = 8;
      g.beginPath();
      const x0 = i < 9 ? rnd(5, i) * PW : X0 + rnd(7, i) * (X1 - X0);
      g.moveTo(x0, i < 9 ? 0 : -250);
      g.lineTo(x0 + (rnd(6, i) - 0.5) * PW * 1.2, PH * 0.7);
      g.stroke();
    }
    // spot heads
    for (let i = 0; i < 6; i++) {
      const x = PW * (0.18 + i * 0.13);
      const gg = g.createRadialGradient(x, PH * 0.02, 0, x, PH * 0.02, 140);
      gg.addColorStop(0, 'rgba(255,255,255,1)');
      gg.addColorStop(1, 'rgba(255,220,255,0)');
      g.fillStyle = gg;
      g.fillRect(x - 140, -140, 280, 300);
    }
    g.restore();
  }
  if (dark && !off) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = 'rgba(30,10,45,0.5)';
    g.fillRect(0, 0, PW, PH);
  }
  picCache.set(key, c);
  return c;
};

/** Soft light cones from the top, moving slowly. */
const cones = (g: CanvasRenderingContext2D, T: number, dark: boolean) => {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const cols = dark ? ['#c9a0ff', '#ff9ad8', '#ffffff'] : ['#ffffff', '#ffc0e6', '#d9c3ff'];
  for (let i = 0; i < 7; i++) {
    // (v22, user: tilting up, the beams seemed to come out of the LED screen) they start at the lamps of the
    // upper truss painted in the stage picture (lamp k at x -1373 + 200 k, y -335 in this layer), above the
    // screen, and reach as far down as before
    const x = -1373 + 200 * (7 + Math.round(i * 1.5));
    const ang = Math.sin(T * 0.45 + i * 1.3) * 0.35 + (i - 3) * 0.06;
    g.save();
    g.translate(x, -335);
    g.rotate(ang);
    const gr = g.createLinearGradient(0, 0, 0, 1760);
    gr.addColorStop(0, hexA(cols[i % 3], dark ? 0.3 : 0.4));
    gr.addColorStop(1, hexA(cols[i % 3], 0));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-16, 0);
    g.lineTo(16, 0);
    g.lineTo(290, 1760);
    g.lineTo(-290, 1760);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.restore();
};

/** Per-stick light control: `sx` = the stick's base on screen (0..1 across the frame), `i` its index. Returns the
 *  colour (undefined: the crowd's own) and how lit it is (0 = off, 1 = on). */
export type PenLight = (sx: number, i: number, T: number, lx: number, par: number) => {col?: string; on: number};

/** The near crowd runs far past the frame on both sides (v16, user: pulled back, only the middle sticks were
 *  there): layer x -4600..6500 (parallax 1.3: the carousel exit pulls back to a 0.3x layer zoom), every stick held by someone. */
export const PEN_X0 = -4600;
export const PEN_X1 = 6500;
/** (v44) the audience goes on to here (layer x), past the old ends */
const PEN_X0_EXT = -12000;
const PEN_X1_EXT = 14000;

type Stick = {x: number; y: number; len: number; w: number; sway: number; col: string; side: number; i: number};

/** The near sticks: the old nine (same random draws, so the usual framing is unchanged) plus as many again
 *  to the left and right at the same spacing. */
const penSticks = (T: number, seed: number, n: number, gold: boolean, beats: number): Stick[] => {
  const cols = gold ? ['#ffd84a', '#ffb02e', '#ff8fb8', '#fff1a8'] : ['#ffd84a', '#ff6fae', '#ff4f6e', '#ffe98a', '#ff9bd0'];
  const sp = (W + 700) / Math.max(1, n);
  const nL = Math.ceil((-350 - PEN_X0) / sp);
  const nR = Math.ceil((PEN_X1 - (W + 350)) / sp);
  const out: Stick[] = [];
  for (let k = -nL; k < n + nR; k++) {
    // k in 0..n-1: the old sticks (indices and draws unchanged); outside: new indices (1000 + ...)
    const i = k >= 0 && k < n ? k : 1000 + k + nL;
    const x = (k + 0.5) * sp - 350 + (rnd(seed, i) - 0.5) * 140;
    // the crowd waves together on the beat grid: one side per bar outside the chorus (beats = 8), per half bar in it
    const sway = Math.sin((2 * Math.PI * T) / (beats * BEAT) + rnd(seed + 1, i) * 0.5) * (beats >= 8 ? 0.2 : 0.3) + (rnd(seed + 2, i) - 0.5) * 0.9;
    out.push({x, y: H + 160 + rnd(seed + 5, i) * 160, len: 460 + rnd(seed + 3, i) * 300, w: 62 + rnd(seed + 4, i) * 34, sway, col: cols[((k % cols.length) + cols.length) % cols.length], side: rnd(seed + 6, i) < 0.5 ? -1 : 1, i});
  }
  // (v44, user: at the end of the pull back at 1:01 / 2:01 the edge of the audience showed for a frame) more of
  // them further out on both sides (new indices, so the sticks that were already there do not change)
  const kL = -nL - Math.ceil((PEN_X0 - PEN_X0_EXT) / sp);
  const kR = n + nR + Math.ceil((PEN_X1_EXT - PEN_X1) / sp);
  for (let k = kL; k < kR; k++) {
    if (k >= -nL && k < n + nR) continue;
    const i = 5000 + k - kL;
    const x = (k + 0.5) * sp - 350 + (rnd(seed, i) - 0.5) * 140;
    const sway = Math.sin((2 * Math.PI * T) / (beats * BEAT) + rnd(seed + 1, i) * 0.5) * (beats >= 8 ? 0.2 : 0.3) + (rnd(seed + 2, i) - 0.5) * 0.9;
    out.push({x, y: H + 160 + rnd(seed + 5, i) * 160, len: 460 + rnd(seed + 3, i) * 300, w: 62 + rnd(seed + 4, i) * 34, sway, col: cols[((k % cols.length) + cols.length) % cols.length], side: rnd(seed + 6, i) < 0.5 ? -1 : 1, i});
  }
  return out;
};

/** Screen x (0..1) of a layer point under the context's current transform. */
const screenX = (g: CanvasRenderingContext2D, x: number, y: number) => g.getTransform().transformPoint(new DOMPoint(x, y)).x / W;

/** Big out-of-focus penlights in the foreground (yellow, pink, red, white). (v16, user) no endless sticks: each
 *  one is a short light tube on a handle (the holders are drawn by `penHolders`). */
const penlights = (g: CanvasRenderingContext2D, T: number, seed: number, n: number, gold = false, beats = 8, light?: PenLight) => {
  const sticks = penSticks(T, seed, n, gold, beats);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const s of sticks) {
    const L = light?.(screenX(g, s.x, s.y), s.i, T, s.x, 1.3) ?? {on: 1};
    if (L.on <= 0.002) continue;
    const col = L.col ?? s.col;
    const {w, len} = s;
    g.save();
    g.translate(s.x, s.y);
    g.rotate(s.sway);
    g.globalAlpha = 0.5 * Math.min(1, L.on);
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(-w, -len - w, w * 2, len + w * 2, w);
    g.fill();
    // switching on: a short white-hot moment before it settles to its colour
    const hot = L.on > 1 ? Math.min(1, L.on - 1) : 0;
    g.globalAlpha = Math.min(1, L.on);
    const gr = g.createLinearGradient(0, -len, 0, 0);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, hot > 0 ? '#ffffff' : col);
    gr.addColorStop(1, hexA(col, 0.55 + 0.4 * hot));
    g.fillStyle = gr;
    g.beginPath();
    g.roundRect(-w / 2, -len, w, len, w / 2);
    g.fill();
    g.restore();
  }
  g.restore();
};

/** The people holding the near penlights, seen from behind: handle, fist, raised arm, the back of the head,
 *  shoulders, and the crowd going on below (dark silhouettes, out of focus like the sticks). They sit below the
 *  frame in every usual framing and only come into view when the camera pulls far back or looks down. */
const penHolders = (g: CanvasRenderingContext2D, T: number, seed: number, n: number, beats = 8) => {
  const sticks = penSticks(T, seed, n, false, beats);
  const body = '#2a1434';
  g.save();
  g.fillStyle = body;
  g.strokeStyle = body;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of sticks) {
    const u = s.w;
    const sd = s.side;
    g.save();
    g.translate(s.x, s.y);
    // handle and fist turn with the stick
    g.save();
    g.rotate(s.sway);
    g.fillStyle = '#3a2a44';
    g.beginPath();
    g.roundRect(-u * 0.4, -u * 0.1, u * 0.8, u * 2.1, u * 0.3);
    g.fill();
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, u * 1.35, u * 0.9, u * 0.78, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const fx = -Math.sin(s.sway) * u * 1.35;
    const fy = Math.cos(s.sway) * u * 1.35;
    // (v17, user: the arms were too long) (v19, user: the arms still looked unnatural: every arm was the same
    // thick zigzag) the forearm continues the line of the stick down from the fist (wrist held straight), the
    // elbow bends a little outward, the upper arm drops to a shoulder beside the head. The forearm is thinner
    // than the upper arm, and every person bends a bit differently.
    const hx = -sd * u * 1.75;
    const hy = u * 5.6;
    const dx = -Math.sin(s.sway);
    const dy = Math.cos(s.sway);
    const fl = u * (2.3 + rnd(seed + 9, s.i) * 0.6);
    const bend = u * (0.25 + rnd(seed + 10, s.i) * 0.6);
    const ex = fx + (dx * 0.7 + 0) * fl + sd * bend;
    const ey = fy + (dy * 0.7 + 0.3) * fl;
    const shx = hx + sd * u * 2.5;
    const shy = u * 7.4;
    g.lineWidth = u * 1.25;
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(shx, shy);
    g.stroke();
    g.lineWidth = u * 0.95;
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(ex, ey);
    g.stroke();
    // back of the head and the shoulders
    g.beginPath();
    g.ellipse(hx, hy, u * 2.2, u * 2.4, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(hx + sd * u * 0.4, u * 10.2, u * 4.8, u * 3.6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(hx - u * 4.4, u * 10.2, u * 9.4, u * 34);
    g.restore();
  }
  // the crowd goes on below the shoulders (no gap between the people)
  g.fillRect(PEN_X0_EXT - 400, H + 160 + 62 * 10.2, PEN_X1_EXT - PEN_X0_EXT + 800, 30000); // (v44) deep enough for the furthest pull back
  g.restore();
};

/** A middle row of the audience (pre-show establishing shot): heads and raised penlights along the bottom of
 *  the frame, smaller and nearly sharp (parallax 1.1). `light` switches the sticks section by section. */
const crowdRow = (g: CanvasRenderingContext2D, T: number, seed: number, light?: PenLight) => {
  const n = 80;
  const x0 = -2400;
  const x1 = 4300;
  const sp = (x1 - x0) / n;
  const body = '#0e0612'; // (v17) nearly black: the row shows only against the light behind it
  const people: {x: number; hy: number; r: number; sway: number; len: number; w: number; side: number; i: number}[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * sp + (rnd(seed, i) - 0.5) * sp * 0.7;
    people.push({x, hy: 1000 + rnd(seed + 1, i) * 70, r: 50 + rnd(seed + 2, i) * 14, sway: Math.sin((2 * Math.PI * T) / (8 * BEAT) + rnd(seed + 3, i) * 0.6) * 0.18 + (rnd(seed + 4, i) - 0.5) * 0.5, len: 190 + rnd(seed + 5, i) * 70, w: 22 + rnd(seed + 6, i) * 8, side: rnd(seed + 7, i) < 0.5 ? -1 : 1, i});
  }
  // the lights first (lighter), then the people over their lower ends
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const p of people) {
    const px = p.x + p.side * p.r * 0.9;
    const py = p.hy - p.r * 1.9;
    const L = light?.(screenX(g, px, py), p.i + 500, T, px, 1.1) ?? {on: 1};
    if (L.on <= 0.002) continue;
    const col = L.col ?? ['#ffd84a', '#ff6fae', '#ff4f6e', '#ffe98a', '#ff9bd0'][p.i % 5];
    g.save();
    g.translate(px, py);
    g.rotate(p.sway);
    g.globalAlpha = 0.45 * Math.min(1, L.on);
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(-p.w, -p.len - p.w, p.w * 2, p.len + p.w * 2, p.w);
    g.fill();
    g.globalAlpha = Math.min(1, L.on);
    const gr = g.createLinearGradient(0, -p.len, 0, 0);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.3, L.on > 1 ? '#ffffff' : col);
    gr.addColorStop(1, hexA(col, 0.6));
    g.fillStyle = gr;
    g.beginPath();
    g.roundRect(-p.w / 2, -p.len, p.w, p.len, p.w / 2);
    g.fill();
    g.restore();
  }
  g.restore();
  g.save();
  g.fillStyle = body;
  g.strokeStyle = body;
  g.lineCap = 'round';
  for (const p of people) {
    const px = p.x + p.side * p.r * 0.9;
    const py = p.hy - p.r * 1.9;
    g.lineWidth = p.r * 0.55;
    g.beginPath();
    g.moveTo(px - Math.sin(p.sway) * p.r * 0.3, py + Math.cos(p.sway) * p.r * 0.3);
    g.lineTo(p.x + p.side * p.r * 1.3, p.hy + p.r * 0.2);
    g.lineTo(p.x + p.side * p.r * 0.7, p.hy + p.r * 1.6);
    g.stroke();
    g.beginPath();
    g.ellipse(p.x, p.hy, p.r * 0.92, p.r, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(p.x, p.hy + p.r * 2.2, p.r * 2.2, p.r * 1.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(x0 - 300, 1130, x1 - x0 + 600, 2400);
  g.restore();
};

// ---------------------------------------------------------------- scenes

/** Jumps (full-body performance): at each time the members jump one after the other (up 0.75 face heights over
 *  0.36 s). A face change belongs at the top of a jump (t + 0.17 + order * 0.05). Returns face-heights. */
export const hops = (times: number[], order: Member[] = ['mew', 'popy', 'halo']) => (m: Member, T: number) => {
  let y = 0;
  const d = order.indexOf(m) * 0.05;
  for (const t0 of times) {
    const u = (T - t0 - d) / 0.36;
    if (u > 0 && u < 1) y -= 0.75 * Math.sin(Math.PI * u);
  }
  return y;
};

/** Expression track: from each time on, every member (or the listed ones) shows that face (full-body variants:
 *  only the face changes, so a swap never makes the body jump). */
export const faces = (list: {t: number; k: Kind | Partial<Record<Member, Kind>>}[]) => (m: Member, T: number): Kind | undefined => {
  let out: Kind | undefined;
  for (const it of list) {
    if (T < it.t) break;
    const k = typeof it.k === 'string' ? it.k : it.k[m];
    if (k) out = k;
  }
  return out;
};

/** A member on the stage, placed by the face: face centre (x, fy), face height f (heads match). */
export type Mem = {m: Member; x: number; fy: number; f: number; k?: Kind; blur?: number; alpha?: number};
export type StageScene = {members: Mem[]; dark?: boolean; pen?: number; penBeats?: number; penLight?: PenLight; crowd?: boolean; face?: (m: Member, T: number) => Kind | undefined; hop?: (m: Member, T: number) => number; rigY?: number; extra?: (g: CanvasRenderingContext2D, T: number) => void; back?: (g: CanvasRenderingContext2D, T: number) => void; /** (v31) the members stand IN the stage light (STAGE_LIGHT): floor shadows, light wrap, key light, beams and haze in front */ light?: boolean; /** (v31) drawn last (after the haze, the penlights and the soft edges, so it is not dulled) but cut out by the members (needs light), i.e. still behind them */ backOver?: (g: CanvasRenderingContext2D, T: number) => void; /** (v32) drawn last, over everything (members included) */ overFront?: (g: CanvasRenderingContext2D, T: number) => void; /** (v43) the beams in front of the members are nearer the camera than the stage plane by this factor (carousel: the front of the ring) */ beamScale?: number};

export const LAY_B: Mem[] = [
  {m: 'mew', x: 560, fy: 300, f: 96},
  {m: 'halo', x: 1400, fy: 300, f: 96},
  {m: 'popy', x: 985, fy: 340, f: 91},
];
/** Chorus wide (as the reference): left and right nearer, the centre farther; the camera drifts across. */
export const LAY_CH: Mem[] = [
  {m: 'popy', x: 1190, fy: 300, f: 104},
  {m: 'mew', x: 640, fy: 250, f: 126},
  {m: 'halo', x: 1760, fy: 230, f: 122},
];

/** Scene position and size of a member's face (for framing close-ups). */
export const faceAt = (lay: Mem[], m: Member) => {
  const p = lay.find((q) => q.m === m)!;
  return {x: p.x, y: p.fy, h: p.f};
};

/** The lighting truss over the front of the stage (v17, user: the lamp the camera tilts into must belong to the
 *  stage): two rails with a zigzag, moving-head fixtures hanging under it every 370 px, their lenses at y -60
 *  (the same points the stage flares come from). Scene layer (parallax 1, with the members). Only drawn when the
 *  frame reaches above y = 40 (it sits above every ordinary framing). */
// (v19, user: the truss hung too low, just over the heads) twice as high above the stage floor: the lenses at
// y -1560 instead of -60 (the floor is at about y 1450). It is now out of every ordinary framing, and the camera
// has to tilt up much faster to reach it in the lamp cuts.
export const RIG_LAMP_Y = -1560;
// (v19) drawn 2.4x bigger (a moving head is about a third of a person; it used to be a tenth), lamps 888 apart
const RIG_S = 2.4;
const RIG_DX = 370 * RIG_S;
export const rigLampX = (x: number) => 220 + RIG_DX * Math.round((x - 220) / RIG_DX);
const overheadRig = (g: CanvasRenderingContext2D, T: number, dark: boolean, lit = 1, lampY = RIG_LAMP_Y) => {
  const inv = g.getTransform().inverse();
  const pts = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
  const top = Math.min(...pts.map((p) => p.y));
  const R = lampY + 60; // the old drawing was made with the lenses at y -60
  if (top > R + 260) return;
  const steel = dark ? '#241a36' : '#3a2c55';
  g.save();
  g.fillStyle = steel;
  g.save();
  g.translate(0, R);
  // scaled about the lens line (y -60 in the drawing below); x in the drawing = scene x / RIG_S
  g.translate(0, -60);
  g.scale(RIG_S, RIG_S);
  g.translate(0, 60);
  const x0 = (Math.min(...pts.map((p) => p.x)) - 400) / RIG_S;
  const x1 = (Math.max(...pts.map((p) => p.x)) + 400) / RIG_S;
  // (v22, user: no horizontal truss - the lamps fixed to the ceiling) the hall's ceiling: a dark underside a
  // little above the lamps (its edge catching a little light), each lamp on its own plate and stem
  const ceil = g.createLinearGradient(0, -146, 0, -420);
  ceil.addColorStop(0, dark ? '#1c1430' : '#2a1f40');
  ceil.addColorStop(1, dark ? '#0c0814' : '#140c20');
  g.fillStyle = ceil;
  g.fillRect(x0, -2400, x1 - x0, 2400 - 146);
  g.fillStyle = dark ? '#2e2446' : '#43355f';
  g.fillRect(x0, -149, x1 - x0, 3);
  g.fillStyle = steel;
  // the lamps, one every RIG_DX
  for (let X = rigLampX(x0 * RIG_S); X <= x1 * RIG_S; X += RIG_DX) {
    const x = X / RIG_S;
    const k = Math.round((X - 220) / RIG_DX);
    // yoke and head, tilting a little with a slow sweep (the light show)
    const tilt = Math.sin(T * 0.8 + k * 1.3) * 0.18;
    g.save();
    // the plate on the ceiling and the stem down to the yoke
    g.fillStyle = steel;
    g.fillRect(x - 24, -147, 48, 6);
    g.fillRect(x - 6, -141, 12, 13);
    g.translate(x, -128);
    g.fillRect(-30, 0, 60, 10);
    g.fillRect(-30, 0, 8, 46);
    g.fillRect(22, 0, 8, 46);
    g.translate(0, 46);
    g.rotate(tilt);
    g.fillStyle = dark ? '#33264a' : '#4a3a6c';
    g.beginPath();
    g.roundRect(-26, -18, 52, 50, 12);
    g.fill();
    // the lens
    const on = (0.75 + 0.25 * Math.sin((2 * Math.PI * T) / (8 * BEAT) + k * 1.7)) * lit;
    const lg = g.createRadialGradient(0, 22, 0, 0, 22, 42); // (v19) a tighter glow: the fixture shows round it
    lg.addColorStop(0, `rgba(255,255,255,${on})`);
    lg.addColorStop(0.28, `rgba(255,214,240,${0.85 * on})`);
    lg.addColorStop(1, 'rgba(255,200,240,0)');
    g.fillStyle = lg;
    g.fillRect(-42, -20, 84, 84);
    g.restore();
  }
  g.restore();
  g.restore();
};

/** Draw one stage frame through a camera. */
let figKeep: HTMLCanvasElement | null = null;
/** (v43) soft masks over the members' faces of the current frame (stageLit), for the light drawn over them */
let faceMask: HTMLCanvasElement | null = null;
/** (v31) The members drawn standing in the stage light (see STAGE_LIGHT). `g` carries the camera transform;
 *  `snap` is the finished stage behind them (screen space). */
const stageLit = (g: Ctx, T: number, sc: StageScene, pose: (p: Mem, i: number) => {x: number; y: number; hop: number; ph: number}, L: typeof STAGE_LIGHT, snap: HTMLCanvasElement, lit: number) => {
  const tf = g.getTransform();
  const face = (p: Mem) => sc.face?.(p.m, T) ?? p.k ?? 'full';
  // contact shadows on the floor (they stay on the floor when a member hops, and fade as she rises)
  if (L.floorShadow > 0) {
    sc.members.forEach((p, i) => {
      const q = pose(p, i);
      const fy = figBottom(p.m, face(p), q.y - q.hop, p.f);
      const up = clamp(-q.hop / (p.f * 2));
      const rx = p.f * 1.7 * (1 - 0.3 * up);
      const ry = p.f * 0.3 * (1 - 0.3 * up);
      g.save();
      g.translate(q.x, fy - p.f * 0.05);
      g.scale(1, ry / rx);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, `rgba(30,6,40,${L.floorShadow * (1 - 0.6 * up)})`);
      gr.addColorStop(1, 'rgba(30,6,40,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
  }
  // the members alone, on their own layer (no sticker drop shadow: the floor shadow grounds them)
  const {c: fc, g: fg} = layer('s2Fig');
  fg.setTransform(tf);
  sc.members.forEach((p, i) => {
    const q = pose(p, i);
    if ((p.blur ?? 0) > 0.5) {
      // (v42) the ones out of focus (B carousel, back of the ring) keep their blur in the lit stage too
      const {c: oc, g: og} = layer('s2LitOne');
      og.setTransform(tf);
      figAt(og, p.m, face(p), q.x, q.y, p.f, 'color', undefined, undefined, {shadow: 0});
      fg.save();
      fg.setTransform(1, 0, 0, 1, 0, 0);
      drawBlurred(fg, oc, p.blur!, p.alpha ?? 1);
      fg.restore();
    } else figAt(fg, p.m, face(p), q.x, q.y, p.f, 'color', undefined, undefined, {shadow: 0, ...(p.alpha !== undefined ? {alpha: p.alpha} : {})});
  });
  fg.setTransform(1, 0, 0, 1, 0, 0);
  // (v43, user: the faces too bright; measured: every light added over them - the beams and haze in front, the
  // wrap, key and rim - lifted the line art by +0.13 and took a third of the colour out) a soft mask over each
  // face: the added light is held back there (STAGE_LIGHT.faceGuard), the face keeps the art's own values
  {
    const {c: mc, g: mg} = layer('s2FaceMask');
    mg.setTransform(tf);
    sc.members.forEach((p, i) => {
      const q = pose(p, i);
      mg.save();
      mg.translate(q.x, q.y);
      mg.scale(1, L.faceH / L.faceW);
      const r = p.f * L.faceW;
      const gr = mg.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.6, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      mg.fillStyle = gr;
      mg.beginPath();
      mg.arc(0, 0, r, 0, Math.PI * 2);
      mg.fill();
      mg.restore();
    });
    mg.setTransform(1, 0, 0, 1, 0, 0);
    faceMask = mc;
  }
  const guard = (lg: CanvasRenderingContext2D) => {
    if (!faceMask || L.faceGuard <= 0) return;
    lg.save();
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'destination-out';
    lg.globalAlpha = L.faceGuard;
    lg.drawImage(faceMask, 0, 0);
    lg.restore();
  };
  // (v42, user: still pasted on) the members take on the light of the place they stand in:
  // ambient - below the chin they sink into the stage's own shade (multiply, stronger toward the feet), the face
  //   stays as drawn; env - the colours of the stage around them, heavily blurred, fall on them (soft-light);
  // rim - a thin coloured back light on their top and side edges from the lamps behind.
  if (L.ambient > 0) {
    const {c: ac, g: ag} = layer('s2Amb');
    ag.fillStyle = '#ffffff';
    ag.fillRect(0, 0, W, H);
    ag.setTransform(tf);
    const shade = sc.dark ? L.ambientDark : L.ambientLight;
    sc.members.forEach((p, i) => {
      const q = pose(p, i);
      const y0 = q.y + p.f * 1.1;
      const y1 = figBottom(p.m, face(p), q.y, p.f);
      const gr = ag.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(1, shade);
      ag.fillStyle = gr;
      ag.fillRect(q.x - p.f * 3, y0, p.f * 6, Math.max(1, y1 - y0) + p.f);
    });
    ag.setTransform(1, 0, 0, 1, 0, 0);
    ag.globalCompositeOperation = 'destination-in';
    ag.drawImage(fc, 0, 0);
    ag.globalCompositeOperation = 'source-over';
    fg.save();
    fg.globalCompositeOperation = 'multiply';
    fg.globalAlpha = L.ambient * lit;
    fg.drawImage(ac, 0, 0);
    fg.restore();
  }
  if (L.env > 0) {
    // (v43) the light of the place falls on them as a filter (multiply of white -> the blurred stage around them):
    // it colours them like their surroundings and can only take light away, never wash them out
    const {c: ec, g: eg} = layer('s2Env');
    eg.fillStyle = '#ffffff';
    eg.fillRect(0, 0, W, H);
    eg.globalAlpha = clamp(L.env * lit);
    eg.drawImage(gpuBlur(snap, L.envBlur), 0, 0);
    eg.globalAlpha = 1;
    if (L.tint > 0) {
      // and one colour over the whole stage (its colour temperature)
      eg.globalCompositeOperation = 'multiply';
      eg.globalAlpha = L.tint * lit;
      eg.fillStyle = sc.dark ? L.tintDark : L.tintLight;
      eg.fillRect(0, 0, W, H);
      eg.globalAlpha = 1;
    }
    eg.globalCompositeOperation = 'destination-in';
    eg.drawImage(fc, 0, 0);
    eg.globalCompositeOperation = 'source-over';
    fg.save();
    fg.globalCompositeOperation = 'multiply';
    fg.drawImage(ec, 0, 0);
    fg.restore();
  }
  if (L.rim > 0) {
    const {c: rc, g: rg} = layer('s2Rim');
    rg.drawImage(fc, 0, 0);
    rg.globalCompositeOperation = 'source-in';
    const rcol = L.rimColors[Math.floor((T * 0.25) % L.rimColors.length)];
    rg.fillStyle = rcol;
    rg.fillRect(0, 0, W, H);
    // keep only the edges that face up and to the sides (lamps above and behind)
    rg.globalCompositeOperation = 'destination-out';
    const w = L.rimWidth * Math.hypot(tf.a, tf.b);
    rg.drawImage(fc, 0, w);
    rg.drawImage(fc, w * 0.7, w * 0.5);
    rg.drawImage(fc, -w * 0.7, w * 0.5);
    rg.globalCompositeOperation = 'source-over';
    guard(rg);
    fg.save();
    fg.globalCompositeOperation = 'screen';
    fg.globalAlpha = L.rim * lit;
    fg.drawImage(gpuBlur(rc, Math.max(1, w * 0.4)), 0, 0);
    fg.restore();
  }
  if (sc.backOver) {
    const k = layer('s2FigKeep');
    k.g.drawImage(fc, 0, 0);
    figKeep = k.c;
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(fc, 0, 0);
  // key light: soft coloured pools from the lamps above, drifting slowly over each member (soft-light, only on her)
  if (L.key > 0) {
    const {c: kc, g: kg} = layer('s2Key');
    kg.setTransform(tf);
    const cols = sc.dark ? ['#d6b8ff', '#ffb3df', '#ffffff'] : ['#fff4e6', '#ffd1ec', '#e6dcff'];
    sc.members.forEach((p, i) => {
      const q = pose(p, i);
      const x = q.x + Math.sin(T * 0.5 + q.ph * 2.3) * p.f * 0.8;
      const y = q.y + p.f * 1.6;
      const r = p.f * 3.4;
      const gr = kg.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, hexA(cols[i % 3], 1));
      gr.addColorStop(1, hexA(cols[i % 3], 0));
      kg.fillStyle = gr;
      kg.fillRect(x - r, y - r, r * 2, r * 2);
    });
    kg.setTransform(1, 0, 0, 1, 0, 0);
    kg.globalCompositeOperation = 'destination-in';
    kg.drawImage(fc, 0, 0);
    guard(kg);
    g.globalCompositeOperation = 'soft-light';
    g.globalAlpha = L.key * lit;
    g.drawImage(kc, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  // light wrap: the blurred stage light behind spills over the members' edges (inside the outline only)
  if (L.wrap > 0) {
    const {c: wc, g: wg} = layer('s2Wrap');
    wg.drawImage(gpuBlur(snap, L.wrapBlur), 0, 0);
    wg.globalCompositeOperation = 'destination-in';
    wg.drawImage(fc, 0, 0);
    wg.globalCompositeOperation = 'destination-out';
    wg.drawImage(gpuBlur(fc, L.wrapBlur * 0.6), 0, 0);
    wg.globalCompositeOperation = 'source-over';
    guard(wg);
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = L.wrap * lit;
    g.drawImage(wc, 0, 0);
  }
  g.restore();
};

export const drawStage = (ctx: Ctx, T: number, sc: StageScene, cam: Cam, o: {bgBlur?: number; memBlur?: number; seed?: number; diffuse?: number; dim?: number; dimAll?: number; off?: number} = {}) => {
  const seed = o.seed ?? 0;
  // (v20) off = 1: every stage light is off (pre-show): the unlit stage picture, no cones, no glow from the
  // top, no bokeh, the lamps on the truss dark
  const off = clamp(o.off ?? 0);
  const lit = 1 - off;
  const pic = stagePicture(!!sc.dark, off >= 1);
  // 1. background, farther layer
  const {c: bc, g: bg} = layer('s2Bg');
  bg.save();
  view(bg, cam, 0.6);
  const s = Math.max(W / pic.width, H / pic.height) * 1.25 * (pic.ext ?? 1);
  bg.drawImage(pic, W / 2 - (pic.width * s) / 2, H / 2 - (pic.height * s) / 2, pic.width * s, pic.height * s);
  if (off > 0 && off < 1) {
    const po = stagePicture(!!sc.dark, true);
    bg.globalAlpha = off;
    bg.drawImage(po, W / 2 - (po.width * s) / 2, H / 2 - (po.height * s) / 2, po.width * s, po.height * s);
    bg.globalAlpha = 1;
  }
  // (v19: the lamp cuts now tilt far up to the raised truss) above the stage picture: the dark of the hall's
  // ceiling, instead of the flat backdrop colour
  {
    const top = H / 2 - (pic.height * s) / 2;
    const dk = sc.dark ? '12,6,20' : '24,10,34';
    const cg = bg.createLinearGradient(0, top + 80, 0, top - 700);
    cg.addColorStop(0, `rgba(${dk},0)`);
    cg.addColorStop(0.35, `rgba(${dk},0.75)`);
    cg.addColorStop(1, `rgba(${dk},1)`);
    bg.fillStyle = cg;
    bg.fillRect(-6000, top - 700, W + 12000, 780);
    bg.fillStyle = `rgb(${dk})`;
    bg.fillRect(-6000, top - 8000, W + 12000, 7302);
  }
  // light cones belong to the stage: they move, turn and zoom with it
  if (lit > 0) {
    bg.globalAlpha = lit;
    cones(bg, T, !!sc.dark);
    bg.globalAlpha = 1;
  }
  bg.restore();
  if (o.dim) {
    bg.fillStyle = `rgba(25,8,40,${o.dim})`;
    bg.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = '#5a2a5e';
  ctx.fillRect(0, 0, W, H);
  drawBlurred(ctx, bc, Math.min(40, (o.bgBlur ?? 9) * (1 + (cam.z - 1) * 0.7)));
  // diffusion (the soft dreamy look of the reference) on the stage only: (v15, user: over-exposed) it used to
  // be screened over the finished frame, members included, which lifted their dark lines and washed them out
  if (sc.dark && o.diffuse === undefined) o = {...o, diffuse: 0.08};
  if ((o.diffuse ?? 0.24) > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBlurred(ctx, ctx.canvas, 26, o.diffuse ?? 0.24, 'screen');
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  view(ctx, cam, 0.6);
  if (lit > 0) glow(ctx, 960, 60, 1100, sc.dark ? '#b48cff' : '#fbeeff', (sc.dark ? 0.25 : 0.4) * lit);
  ctx.restore();
  ctx.save();
  view(ctx, cam, 0.8);
  ctx.globalAlpha = lit;
  if (lit > 0) bokehField(ctx, T, 1300 + seed, sc.dark ? ['#c9a0ff', '#ff9ad8'] : ['#ffffff', '#ffd1ec', '#e2d2ff'], [{n: 14, size: [26, 80], blur: 0.4, alpha: 0.32, speed: 16}]);
  ctx.restore();
  // the house lights down (pre-show): the whole stage dark, members included; the penlights glow over it
  if ((o.dimAll ?? 0) > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(10,4,18,${o.dimAll})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  // 2. members (sharp unless a focus pull asks for blur); gentle sway, never on the beat
  // (v31, user: in the chorus the lights were all under the members, who looked pasted on the backdrop) with
  // sc.light the members stand in the light: a contact shadow on the floor, the light behind them wrapping round
  // their edges, a coloured key light on them, and the stage's beams and haze in the air in front of them
  const L = sc.light && lit > 0 ? STAGE_LIGHT : null;
  let snap: HTMLCanvasElement | null = null;
  if (L) {
    const {c, g: sg} = layer('s2Snap');
    sg.drawImage(ctx.canvas, 0, 0);
    snap = c;
  }
  const drawMem = (g: CanvasRenderingContext2D) => {
    g.save();
    view(g, cam, 1);
    overheadRig(g, T, !!sc.dark, lit, sc.rigY ?? RIG_LAMP_Y);
    sc.back?.(g, T);
    const pose = (p: Mem, i: number) => {
      const ph = ({mew: 0, popy: 1, halo: 2} as Record<Member, number>)[p.m] ?? i;
      const hop = (sc.hop?.(p.m, T) ?? 0) * p.f;
      return {x: p.x + Math.sin(T * 0.7 + ph * 1.7) * 4, y: p.fy + Math.sin(T * 1.25 + ph * 2.1) * 5 + hop, hop, ph};
    };
    if (L) {
      stageLit(g, T, sc, pose, L, snap!, lit);
      sc.extra?.(g, T);
      g.restore();
      return;
    }
    sc.members.forEach((p, i) => {
      const ph = ({mew: 0, popy: 1, halo: 2} as Record<Member, number>)[p.m] ?? i; // (self-check: phase by draw order made the ones behind jump)
      const x = p.x + Math.sin(T * 0.7 + ph * 1.7) * 4;
      const y = p.fy + Math.sin(T * 1.25 + ph * 2.1) * 5 + (sc.hop?.(p.m, T) ?? 0) * p.f;
      if ((p.blur ?? 0) > 0.5) {
        const {c: pc, g: pg} = layer('s2One');
        pg.setTransform(g.getTransform());
        figAt(pg, p.m, sc.face?.(p.m, T) ?? p.k ?? 'full', x, y, p.f);
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        drawBlurred(g, pc, p.blur!, p.alpha ?? 1);
        g.restore();
      } else figAt(g, p.m, sc.face?.(p.m, T) ?? p.k ?? 'full', x, y, p.f, 'color', undefined, undefined, p.alpha !== undefined ? {alpha: p.alpha} : undefined);
    });
    sc.extra?.(g, T);
    g.restore();
  };
  if ((o.memBlur ?? 0) > 0.5) {
    const {c: mc, g: mg} = layer('s2Mem');
    drawMem(mg);
    drawBlurred(ctx, mc, o.memBlur!);
  } else drawMem(ctx);
  // (v31) the stage's own beams again, in the air in front of the members (same lamps, same layer), and haze
  if (L) {
    // (v32, user: the light moved less than the members - not real) the beams in front hang from lamps over the
    // members, so they are drawn in the members' own plane (parallax 1: they move exactly as the members do, never
    // less), and the haze lies on the stage floor at their feet instead of being stuck to the screen
    // (v43) drawn on their own layer and held back over the faces (faceGuard), then laid on with 'screen'
    const {c: lc, g: lg} = layer('s2FrontLight');
    lg.save();
    // (v43, user: at 主張強すぎ the middle beams did not scale with the picture) in the carousel the member in
    // front stands far nearer the camera than the stage plane; the beams in front of her scale with her plane
    if (sc.beamScale && sc.beamScale !== 1) {
      lg.translate(W / 2, H / 2);
      lg.scale(sc.beamScale, sc.beamScale);
      lg.translate(-W / 2, -H / 2);
    }
    view(lg, cam, L.beamsParallax);
    lg.globalAlpha = L.beams * lit;
    cones(lg, T, !!sc.dark);
    lg.globalAlpha = 1;
    lg.restore();
    lg.save();
    view(lg, cam, L.beamsParallax);
    if (L.haze > 0) {
      const floorY = Math.max(...sc.members.map((p) => figBottom(p.m, sc.face?.(p.m, T) ?? p.k ?? 'full', p.fy, p.f)), 900);
      lg.globalCompositeOperation = 'lighter';
      const hz = lg.createLinearGradient(0, floorY + 120, 0, floorY - 520);
      hz.addColorStop(0, `rgba(255,236,250,${L.haze * lit})`);
      hz.addColorStop(1, 'rgba(255,236,250,0)');
      lg.fillStyle = hz;
      lg.fillRect(-3000, floorY - 520, W + 6000, 2400);
    }
    lg.restore();
    if (faceMask && L.faceGuard > 0) {
      lg.save();
      lg.globalCompositeOperation = 'destination-out';
      lg.globalAlpha = L.faceGuard;
      lg.drawImage(faceMask, 0, 0);
      lg.restore();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(lc, 0, 0);
    ctx.restore();
  }
  // 2b. a middle row of the audience along the bottom (pre-show only), nearly sharp
  if (sc.crowd) {
    const {c: cc, g: cg} = layer('s2Crowd');
    cg.save();
    view(cg, cam, 1.1);
    crowdRow(cg, T, 1500 + seed, sc.penLight);
    cg.restore();
    drawBlurred(ctx, cc, 2.5);
  }
  // 3. foreground penlights, nearer layer, out of focus; (v16) the people holding them below
  if ((sc.pen ?? 1) > 0) {
    const n = Math.round(9 * (sc.pen ?? 1));
    const {c: hc, g: hg} = layer('s2Hold');
    hg.save();
    view(hg, cam, 1.3);
    // (only when the frame reaches down to the hands: the holders start at the handles, y >= H + 150)
    const inv = hg.getTransform().inverse();
    const lowY = Math.max(...[[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)).y));
    const show = lowY > H + 120;
    if (show) penHolders(hg, T, 1400 + seed, n, sc.penBeats ?? 8);
    hg.restore();
    if (show) drawBlurred(ctx, hc, 13);
    const {c: fc, g: fg} = layer('s2Fg');
    fg.save();
    view(fg, cam, 1.3);
    penlights(fg, T, 1400 + seed, n, false, sc.penBeats ?? 8, sc.penLight);
    fg.restore();
    drawBlurred(ctx, fc, 13, 0.95, 'screen');
  }
  // 5. soft, slightly darker edges (the reference's frame edges are out of focus)
  edgeSoft(ctx);
  // (v31) layers that must stay bright but behind the members (爆レス columns)
  if (sc.backOver) {
    const {c: oc, g: og} = layer('s2Over');
    sc.backOver(og, T);
    if (L) {
      og.setTransform(1, 0, 0, 1, 0, 0);
      og.globalCompositeOperation = 'destination-out';
      if (figKeep) og.drawImage(figKeep, 0, 0);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(oc, 0, 0);
    ctx.restore();
  }
  if (sc.overFront) {
    ctx.save();
    sc.overFront(ctx, T);
    ctx.restore();
  }
};

/** Blurred copy of the frame shown only toward the edges (radial mask), plus a light vignette. */
export const edgeSoft = (ctx: Ctx, amt = 1) => {
  const {c, g} = layer('edgeSoft');
  g.drawImage(gpuBlur(ctx.canvas, 22), 0, 0);
  g.globalCompositeOperation = 'destination-in';
  const rg = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 1.05);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(1, `rgba(0,0,0,${amt})`);
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, H * 1.1);
  vg.addColorStop(0, 'rgba(60,10,60,0)');
  vg.addColorStop(1, `rgba(60,10,60,${0.22 * amt})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

/** Glow on top of everything (final chorus): soft light blobs drifting, sparkles, a warm wash at the top. */
/** Glow over the top of the stage. With a camera the light belongs to the stage: it moves, turns and zooms
 *  with it (parallax 0.7) instead of sitting on the screen. */
export const glowTop = (ctx: Ctx, T: number, seed = 0, cam?: Cam) => {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (cam) view(ctx, cam, 0.7);
  ctx.globalCompositeOperation = 'screen';
  const top = ctx.createLinearGradient(0, -200, 0, H * 0.6);
  top.addColorStop(0, 'rgba(255,240,250,0.3)'); // (v15, user: over-exposed) was 0.55
  top.addColorStop(1, 'rgba(255,240,250,0)');
  ctx.fillStyle = top;
  ctx.fillRect(-W, -400, W * 3, H * 0.6 + 400);
  for (let i = 0; i < 7; i++) {
    const x = (rnd(seed + 600, i) * W + T * (30 + i * 8)) % (W + 400) - 200;
    const y = rnd(seed + 601, i) * H * 0.8 + Math.sin(T * 0.6 + i) * 60;
    glow(ctx, x, y, 220 + rnd(seed + 602, i) * 260, ['#ffd6ec', '#fff1c4', '#e6d6ff'][i % 3], 0.28);
  }
  ctx.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // (it may be called from inside a camera transform: the stage's back layer)
  if (cam) view(ctx, cam, 0.85);
  bokehField(ctx, T, 1700 + seed, ['#ffffff', '#ffe6f4', '#fff3c8'], [{n: 18, size: [10, 36], blur: 0.5, alpha: 0.8, speed: 30}]);
  ctx.restore();
};

// (v15, user: over-exposed) no lift (it raised every dark line), less bloom, neutral contrast and saturation
// (any push sends the light skin into pure white)
const stageGrade = (a: number, b: number, dark = false) =>
  grade(a, b, dark ? {bloom: 0.08, threshold: 0.96, contrast: 1.0, saturation: 1.0, vignette: 0.3} : {bloom: 0.08, threshold: 0.96, contrast: 1.0, saturation: 1.0, vignette: 0.12});
/** (v16, user: in the choruses the members may be somewhat over-exposed) a brighter, glowing look for the
 *  chorus shots only: more bloom from a lower threshold and a touch of exposure; still no lift (it greys the
 *  dark lines) and no contrast / saturation push. */
// (measured: bloom 0.2 from 0.86 with +4 % exposure clipped 40-60 % of every face - far past "somewhat"; this
// level glows on the highlights and lifts the faces a little, ~10-15 % of a face clipping at most)
export const CHORUS_GRADE: Partial<Fx> = {bloom: 0.2, threshold: 0.9, exposure: 1.0, contrast: 1.0, saturation: 1.0, vignette: 0.12};

// ---------------------------------------------------------------- pre-show (before the music)

/** Pre-show (v16, user; v17: black first): a black, silent screen; around the first sound of the music the
 *  audience's penlights come on quickly, section by section (red, purple, yellow); then the stage lights hit,
 *  the camera pushes into the stage and cuts straight to ア. The same venue as every stage shot after it. */
export const tPreShow = (a: number, b: number, o: {sections: {t: number; m: Member; from: number; to: number}[]; lightsOn: number; lightsFull?: number}): Part => {
  const base: Cam = {x: 960, y: 600, z: 0.86, r: 0.02};
  // a slow push straight in (no sideways travel), turning a little counter-clockwise as the intro will; from the
  // lights on, one accelerating push into the cut
  const rig = intoCut((T) => {
    const t = Math.max(0, T - a);
    return {x: 960, y: base.y, z: base.z * Math.exp(0.03 * t), r: base.r - 0.007 * t};
  }, b, {dur: b - o.lightsOn + 0.04, tau: 0.075, zoom: 1.5, rot: -0.035});
  // each section lights from its middle outward (a ripple through the crowd), with a white-hot moment
  const secOf = (lx: number, par: number) => {
    const z = 1 + (base.z - 1) * par;
    const sx = (W / 2 + (lx - (W / 2 + (base.x - W / 2) * par)) * z) / W;
    return o.sections.find((s) => sx >= s.from && sx < s.to);
  };
  const penLight: PenLight = (_sx, i, T, lx, par) => {
    const s = secOf(lx, par);
    if (!s) return {on: 0};
    const z = 1 + (base.z - 1) * par;
    const sx = (W / 2 + (lx - (W / 2 + (base.x - W / 2) * par)) * z) / W;
    const mid = (Math.max(-0.2, s.from) + Math.min(1.2, s.to)) / 2;
    // (v17, user: quick) the whole section in about a tenth of a second, from its middle outward
    const t0 = s.t + Math.min(0.1, Math.abs(sx - mid) * 0.25) + rnd(77, i) * 0.03;
    const k = (T - t0) / 0.08;
    if (k <= 0) return {on: 0};
    const hot = 0.9 * Math.exp(-Math.max(0, T - t0 - 0.08) / 0.14);
    return {col: COLORS[s.m].main, on: Math.min(1, k) * (1 + hot)};
  };
  const sc: StageScene = {members: [], pen: 1.0, penLight, crowd: true};
  // (v17, user) black and silent first: nothing at all shows until the first penlights
  // (v19, user: not pure black - very dark, but the stage can be seen) the house lights are down to 12 %
  // (v20, user: the stage was only dimmed, its lights kept sweeping) until the lights hit, every stage light
  // is off (unlit stage picture, no cones, no bokeh, dark lamps); a light veil keeps it very dark
  // (v28, user: the stage lights come up slowly, from lightsOn to lightsFull) smooth ease over that span
  const full = Math.max(o.lightsOn + 0.08, o.lightsFull ?? o.lightsOn + 0.08);
  const offK = (T: number) => {
    const x = clamp((T - o.lightsOn) / (full - o.lightsOn));
    return 1 - x * x * (3 - 2 * x);
  };
  const dimAll = (T: number) => 0.3 * offK(T);
  const shot: Shot = {
    a,
    b,
    label: 'pre-show',
    cam: rig,
    draw: (ctx, T) => {
      const c = rig(T);
      drawStage(ctx, T, sc, c, {dimAll: dimAll(T), off: offK(T)});
      // (v17: pure black until the first penlights) (v19, user: very dark but not black) only the first 0.3 s
      // fade up from black to the dark stage
      const blk = 1 - clamp((T - a) / 0.3);
      if (blk > 0) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = blk;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      // the lit sections light the haze above them a little (their colour), before the stage does
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      o.sections.forEach((s) => {
        const k = clamp((T - s.t) / 0.15) * (0.3 + 0.7 * offK(T));
        if (k <= 0) return;
        const x = ((Math.max(-0.1, s.from) + Math.min(1.1, s.to)) / 2) * W;
        glow(ctx, x, H + 60, 760, COLORS[s.m].main, 0.42 * k);
      });
      ctx.restore();
      // the stage lights hit: the lamps on the truss flare into the lens (scene points through the camera)
      if (T >= o.lightsOn) {
        // (v28) the flares come up with the lights, the burst when they are full
        const k = (1 - offK(T)) * (0.45 + 0.8 * Math.exp(-Math.max(0, T - full) / 0.22));
        [[220, -40, '#ffd0ec'], [960, -90, '#fff1c9'], [1700, -40, '#e2d2ff']].forEach(([x, y, col]) => {
          const q = [((x as number) - c.x) * c.z, ((y as number) - c.y) * c.z];
          lensFlare(ctx, W / 2 + Math.cos(c.r) * q[0] - Math.sin(c.r) * q[1], H / 2 + Math.sin(c.r) * q[0] + Math.cos(c.r) * q[1], k, col as string);
        });
      }
    },
  };
  return {shots: [shot], fx: [rigBlur(rig, a, b), stageGrade(a, b)]};
};

// ---------------------------------------------------------------- generic stage shot

export type StageShot = {
  a: number;
  b: number;
  label: string;
  scene: StageScene;
  rig: Rig;
  bgBlur?: number;
  memBlur?: (T: number) => number; // (v15: no longer used for entries: the user wants no blur going in or out)
  dim?: (T: number) => number;
  text?: (ctx: Ctx, T: number) => void;
  /** white at the end (overexposed push) */
  whiteOut?: [number, number];
  /** white fading away at the start */
  whiteIn?: number;
};

export const stageShots = (list: StageShot[], o: {dark?: boolean; grade?: Partial<Fx>} = {}): Part => ({
  shots: list.map((s, i) => ({
    a: s.a,
    b: s.b,
    label: s.label,
    cam: s.rig,
    draw: (ctx: Ctx, T: number) => {
      drawStage(ctx, T, s.scene, s.rig(T), {bgBlur: s.bgBlur, memBlur: s.memBlur?.(T), dim: s.dim?.(T), seed: i * 7});
      s.text?.(ctx, T);
      let wv = 0;
      if (s.whiteOut) wv = Math.max(wv, Math.pow(prog(T, s.whiteOut[0], s.whiteOut[1]), 1.6) * 0.92);
      if (s.whiteIn) wv = Math.max(wv, 1 - prog(T, s.a, s.a + s.whiteIn));
      if (wv > 0) {
        ctx.save();
        ctx.globalAlpha = wv;
        ctx.fillStyle = '#fff8fc';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    },
  })),
  fx: [...list.map((s) => rigBlur(s.rig, s.a, s.b)), o.grade ? grade(list[0].a, list[list.length - 1].b, o.grade) : stageGrade(list[0].a, list[list.length - 1].b, o.dark)],
});

// ---------------------------------------------------------------- text helpers

/** Each glyph of a word gets its own entrance (not a text box): 'slam' (drops in from big, springs),
 *  'fly' (own path, spin, scale), 'rise' (shoots up stretched, squashes on landing), 'spin' (a half turn
 *  while growing). After landing the glyphs keep living (slow bob, sway, a slow swell); on `until` they
 *  swell and vanish. Small star bursts where each one lands. */
export type WordFx = 'slam' | 'fly' | 'rise' | 'spin';
export const glyphWord = (ctx: Ctx, ps: Placed[], T: number, at: number, style: GStyle, kind: WordFx, o: {step?: number; until?: number; seed?: number; spark?: string[] | null; noGuard?: boolean; upright?: boolean; follow?: DOMMatrix} = {}) => {
  if (!ps.length) return;
  const step = o.step ?? 0.05;
  const out = o.until !== undefined ? clamp((T - (o.until - 0.08)) / 0.08) : 0;
  if (out >= 1) return;
  const sparkC = o.spark === null ? null : (o.spark ?? ['#ffffff', '#ffd1e6', '#fff1b8']);
  ctx.save();
  if (!o.noGuard) guardFrame(ctx, ps); // (v29) noGuard: the words may leave the frame (they move with the stage)
  // (v37) the camera follow goes on top of the frame guard: the guard fits the laid-out words once (as before) and
  // the follow then moves that whole picture exactly as the stage moves. (v35/v36 ran the guard after the follow,
  // so while the camera's move made the words bigger the guard kept squeezing them back - they looked stuck, then
  // let go: the unnatural start)
  if (o.follow) ctx.setTransform(o.follow.multiply(ctx.getTransform()));
  ps.forEach((p, j) => {
    const t = T - (at + j * step);
    if (t <= 0) return;
    const sd = (o.seed ?? 3) * 31 + j;
    const sp = 1 - Math.exp(-9 * t) * Math.cos(15 * t); // spring 0 -> 1
    const off = 1 - sp;
    let x = p.x;
    let y = p.y;
    let r = p.rot;
    let sc = 1;
    let sy = 1;
    const a = clamp(t / 0.06) * (1 - out);
    if (kind === 'slam') {
      sc = 1 + 1.8 * Math.exp(-10 * t) * Math.cos(8 * t);
      r += (rnd(sd, 1) - 0.5) * 0.5 * Math.exp(-8 * t);
    } else if (kind === 'fly') {
      const ang = -Math.PI / 2 + (o.upright ? 0 : (rnd(sd, 2) - 0.5) * 2.6);
      const dist = 1.4 * p.size * (0.7 + rnd(sd, 3) * 0.6);
      x -= Math.cos(ang) * dist * off;
      y -= Math.sin(ang) * dist * off;
      r += (rnd(sd, 4) - 0.5) * 1.6 * off;
      sc = 1 + ((rnd(sd, 5) < 0.5 ? 0.3 : 2.0) - 1) * off;
    } else if (kind === 'rise') {
      y += p.size * 1.3 * Math.exp(-11 * t);
      sy = 1 + 0.45 * Math.exp(-11 * t) - 0.18 * Math.exp(-6 * Math.max(0, t - 0.1)) * Math.sin(Math.max(0, t - 0.1) * 18);
    } else {
      r += (j % 2 ? 1 : -1) * Math.PI * off;
      sc = Math.max(0.01, sp);
    }
    // v46: bridge columns keep their vertical glyph orientation throughout the entrance and hold.
    if (o.upright) r = p.rot;
    // after landing: still alive
    const life = Math.max(0, t - 0.3);
    y += Math.sin(T * 2.1 + j * 1.3) * p.size * 0.018;
    if (!o.upright) r += Math.sin(T * 1.3 + j * 0.9) * 0.025 * Math.min(1, life * 3);
    // (v37) no slow swell while following the camera (it pushed against the pull back)
    sc *= (o.follow ? 1 : 1 + 0.035 * Math.min(1, life / 2)) * (1 + 0.35 * out);
    ctx.save();
    ctx.translate(x, y);
    if (sy !== 1) ctx.scale(1 / Math.sqrt(sy), sy);
    drawGlyph(ctx, p.ch, style, p.size, 0, 0, r, sc, a);
    ctx.restore();
    if (sparkC) {
      const bk = clamp((t - 0.1) / 0.32);
      if (bk > 0 && bk < 1)
        for (let q = 0; q < 4; q++) {
          const ang = rnd(sd, 10 + q) * Math.PI * 2;
          const d = p.size * (0.45 + 0.5 * easeOutCubic(bk));
          ctx.fillStyle = sparkC[q % sparkC.length];
          star4(ctx, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, p.size * 0.09 * (1 - bk), 0.25, 0);
          ctx.fill();
        }
    }
  });
  ctx.restore();
};

/** A phrase in giant letters (screen space), whole at once (a fast cascade, not tied to the voice). */
export const bigPhrase = (ctx: Ctx, gs: Glyph[], T: number, at: number, o: {x: number; y: number; size: number; rot?: number; until?: number; fx?: WordFx}) => {
  const ps = layoutLine(gs, {size: o.size, tracking: -0.06, sizeJitter: 0.1, rotJitter: 0.09, yJitter: o.size * 0.08, seed: Math.round(o.x + o.y), smallKana: 0.72, weight: 400});
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.rot) ctx.rotate(o.rot);
  glyphWord(ctx, ps, T, at, BIG, o.fx ?? 'slam', {step: 0.045, until: o.until, seed: Math.round(o.x)});
  ctx.restore();
};

/** Letters scattered around the frame (ちゃんと / 見えてる / サイリウム): reading order kept. */
export const scatter = (ctx: Ctx, gs: Glyph[], T: number, at: number, pos: [number, number][], size: number, until?: number, fx: WordFx = 'fly', follow?: DOMMatrix, noGuard = false) => {
  const ps: Placed[] = gs.map((g, j) => ({
    ch: g.ch,
    t: g.t,
    x: pos[j % pos.length][0],
    y: pos[j % pos.length][1],
    size: size * ('ゃゅょっャュョッ'.includes(g.ch) ? 0.72 : 1),
    rot: (rnd(77, j + gs.length) - 0.5) * 0.25,
    i: j,
  }));
  glyphWord(ctx, ps, T, at, BIG, fx, {step: 0.06, until, seed: gs.length * 7 + Math.round(pos[0][0]), follow, noGuard});
};

// ---------------------------------------------------------------- B section (one stage, continuous camera, whips)

export type BPlan = {
  start: number;
  cut: number; // wide -> close (overexposed push)
  wide: Chunk[]; // 客席が / 居ようが居まいが / 関係ない
  close1: {m: Member; c: Chunk}; // 会場が大きい
  close2: {m: Member; c: Chunk}; // 小さいとか (after a whip)
  back: Chunk; // 気にしない (pull back)
  s3: number; // start of the scatter part (whip in)
  a1: {m: Member; c: Chunk; pos: [number, number][]}; // ちゃんと
  a2: {c: Chunk; pos: [number, number][]}; // 見えてる (zoom whip onto the same face)
  a3: {m: Member; c: Chunk; pos: [number, number][]}; // 君の (whip)
  a4: {c: Chunk; pos: [number, number][]}; // サイリウム (pull back to wide)
  end: number;
};

export const tBSection = (p: BPlan): Part => {
  // faces change only at the cut into the close-ups (with the white flash) and in the pull back (a performance)
  const sc: StageScene = {members: LAY_B, pen: 0.8, light: true, face: faces([{t: p.start, k: 'full'}, {t: p.cut, k: 'full_wink'}])};
  const F = (m: Member) => faceAt(LAY_B, m);
  // close framing: the face lands ~300 px from the top of the screen at zoom z (as in the reference)
  const up = (m: Member, z: number, faceY = 300) => ({x: F(m).x, y: F(m).y + (540 - faceY) / z, z});
  // wide: roll settles in 0.6 s, push 1.0 -> 1.55 easing out, tilt up; then an accelerating push into white
  // measured: roll -6deg settling in 0.6 s, push 1.0 -> 1.6 easing out while tilting up, then an accelerating push
  // the reference camera of this shot (validated: push x1.52, roll +5.8 deg, tilting up from the waists to the
  // faces); its translation at 40 % reproduces the reference framing (faces ~170 px -> ~240 px from the top).
  // Over the last 0.32 s an accelerating push into white.
  // wide: pushing in while tilting up (the picture travels down), fast in, slow but moving, accelerating
  // into the white
  const c1 = up(p.close1.m, 2.25);
  const c1side = Math.sign(c1.x - 960) || 1; // the push travels toward the first close-up's side, the close shot goes on that way
  // (v15, user: the white was hiding the push) the last 0.5 s push hard toward the first close-up's face,
  // turning the way the close shot arrives; the white only on the last frames
  const wide = intoCut(glide(p.start, p.cut, {x: 960, y: 440, z: 1.15, r: -0.02}, {dir: [-0.25, 1], px: 55, rot: -0.015, zoom: 0.1, inK: 12, outK: 12}), p.cut, {dur: 0.5, tau: 0.13, zoom: 2.1, rot: -0.14, to: {x: c1.x - 70 * c1side, y: c1.y + 50}}); // (roll: the glide's way and the close shot's)
  const c2 = up(p.close2.m, 2.25);
  const whipT = p.close2.c.t - 0.3;
  const backT = p.back.t - 0.27;
  // close 1 -> whip -> close 2 -> pull back in ONE shot: a camera path through the framings (spline: the speed
  // never drops to zero at a framing; slow while a phrase is sung, fast in the whip and the pull back)
  const close = flow([
    // (v16, user: the travel onto MEW's face was too wide) starts nearer her (45 px instead of 130 short of her),
    // so the arrival is a short move and her face reads at once
    {t: p.cut, cam: {x: c1.x - 45 * c1side, y: c1.y + 45, z: 2.6, r: 0.13}},
    {t: p.cut + 0.3, cam: {x: c1.x + 8 * c1side, y: c1.y + 15, z: 2.32, r: 0.08}},
    {t: whipT + 0.05, cam: {x: c1.x - 25, y: c1.y - 5, z: 2.38, r: 0.06}},
    {t: whipT + 0.27, cam: {x: c2.x + 25, y: c2.y + 8, z: 2.3, r: -0.07}},
    {t: backT + 0.1, cam: {x: c2.x - 20, y: c2.y - 8, z: 2.38, r: -0.1}},
    {t: backT + 0.6, cam: {x: 985, y: 572, z: 1.08, r: 0.05}},
    {t: p.s3, cam: {x: 945, y: 560, z: 1.14, r: 0.08}},
  ]);
  const W1 = [
    {x: 700, y: 760, size: 230},
    {x: 820, y: 770, size: 220},
    {x: 760, y: 780, size: 270},
  ];
  const part = stageShots([
    {
      a: p.start,
      b: p.cut,
      label: 'B wide',
      scene: sc,
      rig: wide,
      whiteIn: 0.24, // (v17) out of the white the cards' ground flashed into (the cards fly off over it)
      whiteOut: [p.cut - 0.09, p.cut],
      text: (ctx, T) => {
        p.wide.forEach((c, i) => {
          const next = p.wide[i + 1];
          if (T < c.t - 0.08 || (next && T >= next.t - 0.08)) return;
          // red bloom behind the last phrase (関係ない)
          if (i === p.wide.length - 1) {
            const k = 1 - prog(T, c.t - 0.05, c.t + 0.35);
            if (k > 0) {
              ctx.save();
              ctx.globalCompositeOperation = 'screen';
              glow(ctx, 760, 760, 900, '#ff3d6e', 0.55 * k);
              ctx.restore();
            }
          }
          bigPhrase(ctx, c.gs, T, c.t - 0.08, {...W1[i % W1.length], rot: -0.04});
        });
      },
    },
    {
      a: p.cut,
      b: p.s3,
      label: 'B close / whip / back [path]',
      scene: sc,
      rig: close,
      whiteIn: 0.18,
      text: (ctx, T) => {
        if (T < p.close2.c.t - 0.1) bigPhrase(ctx, p.close1.c.gs, T, p.close1.c.t - 0.05, {x: 1150, y: 640, size: 210, rot: -0.35, until: p.close2.c.t - 0.1});
        else if (T < p.back.t - 0.1) bigPhrase(ctx, p.close2.c.gs, T, p.close2.c.t - 0.08, {x: 760, y: 820, size: 230, rot: -0.12, until: p.back.t - 0.1});
        else bigPhrase(ctx, p.back.gs, T, p.back.t - 0.1, {x: 820, y: 820, size: 300, rot: -0.04});
      },
    },
  ]);
  const car = carousel(p);
  part.shots.push(...car.shots);
  part.fx.push(...car.fx);
  return part;
};

/** ちゃんと見えてる 君のサイリウム: the three on a turning ring. Each phrase turns a new member to the front
 *  (big, sharp, giant letters around her); the other two shrink and blur behind. The turn starts fast and
 *  settles slowly. サイリウム pulls back to the three side by side. */
const carousel = (p: BPlan): Part => {
  const others = ORDER.filter((m) => m !== p.a1.m && m !== p.a3.m);
  const fronts: Member[] = [p.a1.m, others[0] ?? p.a1.m, p.a3.m];
  const turns = [p.a2.c.t - 0.14, p.a3.c.t - 0.14];
  const backT = p.a4.c.t - 0.12;
  // the ring never stops: a slow constant turn plus a fast (gaussian) turn at each phrase; each phrase's member
  // is in front in the middle of her phrase
  const mids = [(p.s3 + turns[0]) / 2, (turns[0] + turns[1]) / 2, (turns[1] + backT) / 2];
  const v0 = 0.02;
  const sig = 0.06; // fast turns: in front earlier and longer (user); (v16, user) faster still (was 0.085)
  const erf = (x: number) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  const G = (T: number, t0: number) => 0.5 * (1 + erf((T - t0) / (sig * Math.SQRT2)));
  const step = (T: number) => {
    let st = v0 * (T - mids[0]);
    turns.forEach((t, j) => {
      const L = mids[j + 1] - mids[j];
      st += ((1 - v0 * L) * (G(T, t) - G(mids[0], t))) / Math.max(1e-6, G(mids[j + 1], t) - G(mids[j], t));
    });
    return st;
  };
  // at サイリウム the camera dollies back; the ring keeps its order, the faces stay clear (self-check)
  const dolly = (T: number) => 1 - Math.exp(-Math.max(0, T - backT) / B_PULLBACK.dollyTau); // quicker, so it is seen before the cut
  const ringMem = (T: number): Mem[] => {
    const kb = dolly(T);
    // in the pull back the ring holds still (HALO went off to the left before)
    const st = step(Math.min(T, backT + 0.1));
    return fronts
      .map((m, k) => {
        const th = ((k - st) * Math.PI * 2) / 3;
        const d = (1 + Math.cos(th)) / 2;
        const sh = lerp(1, lerp(1.0, 0.36, d), kb);
        // (v16, user: the two behind a little wider apart) the ring is wider at the back than at the front
        return {m, x: 960 + lerp(430, 560, 1 - d) * Math.sin(th) * lerp(1, 1.08, kb), fy: lerp(lerp(262, 330, d), lerp(225, 380, d), kb), f: lerp(150, 400, d * d) * sh, blur: lerp(5, 0, d * d) * (1 - kb), d} /* (v15: was 10; a softer blur kept the back faces from going pale) */;
      })
      .sort((u, v) => u.d - v.d)
      .map(({m, x, fy, f, blur}) => ({m, x, fy, f, blur}));
  };
  // camera: no sideways travel - the ring does the moving. It arrives pushed in and settles (decelerating),
  // keeps easing back slowly, dollies back at サイリウム, and pushes out into the chorus at the end
  const rig: Rig = (T) => {
    const t = Math.max(0, T - p.s3);
    const kb = dolly(T);
    const e = Math.exp(-t / 0.18);
    const out = Math.exp((T - p.end) / B_PULLBACK.accelerationSeconds); // (user) the pull back before the cut: farther, faster
    return {x: 960, y: 540 + 140 * kb - 12 * t, z: (1 + 0.16 * e) * Math.exp(-0.035 * t) * lerp(1, B_PULLBACK.dollyZoom, kb) * (1 - B_PULLBACK.endPull * out), r: 0.05 + 0.08 * e - 0.016 * t - 0.06 * out};
  };
  const face = faces([
    {t: p.s3, k: 'full_wink'},
    {t: turns[1], k: 'full_soft'},
  ]);
  const shot: Shot = {
    a: p.s3,
    b: p.end,
    label: 'B carousel',
    cam: rig,
    draw: (ctx, T) => {
      // (v43) the front of the ring is nearer the camera: until the pull back its plane is 1/0.36 the size of the
      // stage plane, less what the camera's own dolly already gives (B_PULLBACK.frontBeams: 1 = exact, 0 = off)
      const kbN = dolly(T);
      const frontPlane = (lerp(1, 0.36, kbN) / 0.36) * (B_PULLBACK.dollyZoom / lerp(1, B_PULLBACK.dollyZoom, kbN));
      drawStage(ctx, T, {members: ringMem(T), pen: 0.9, face, light: true /* (v42, user: the サイリウム was not in the same light) */, beamScale: Math.pow(frontPlane, B_PULLBACK.frontBeams)}, rig(T), {seed: 9});
      const parts = [p.a1, p.a2, p.a3, p.a4];
      parts.forEach((q, i) => {
        const next = parts[i + 1];
        if (T < q.c.t - 0.12 || (next && T >= next.c.t - 0.12)) return;
        // (v35, user) サイリウム goes back with the camera as it pulls back faster and faster into the chorus
        const fol = i === 3 && SAIRIUM.follow > 0 ? followM(rig, q.c.t - 0.12 + SAIRIUM.settle, T, SAIRIUM.follow) : undefined;
        scatter(ctx, q.c.gs, T, q.c.t - 0.12, q.pos, i === 3 ? 360 : 400, next ? next.c.t - 0.12 : undefined, 'fly', fol);
      });
    },
  };
  return {shots: [shot], fx: [rigBlur(rig, p.s3, p.end)]};
};

/** The stage's lights flaring into the lens: scene points (on the top truss) seen through the shot's camera,
 *  so they move, turn and zoom with the stage; brightness breathes over two bars. */
export const stageFlares = (a: number, b: number, rig: Rig, glowOn?: boolean): Shot => ({
  a,
  b,
  z: 5,
  label: 'stage lights',
  draw: (ctx, T) => {
    const c = rig(T);
    // (v17) at the lamps of the overhead truss; (v19) the truss went up (RIG_LAMP_Y), these stay where they
    // were, just above the top of the frame
    [[220, -60, 0], [960, -60, 1.7], [1700, -60, 3.1]].forEach(([x, y, ph]) => {
      const q = [(x - c.x) * c.z, (y - c.y) * c.z];
      const sx = W / 2 + Math.cos(c.r) * q[0] - Math.sin(c.r) * q[1];
      const sy = H / 2 + Math.sin(c.r) * q[0] + Math.cos(c.r) * q[1];
      lensFlare(ctx, sx, sy, 0.55 + 0.25 * Math.sin((2 * Math.PI * T) / (8 * BEAT) + ph), ['#ffd0ec', '#fff1c9', '#e2d2ff'][Math.round(ph) % 3]);
    });
    if (glowOn) glowTop(ctx, T, 3, c);
  },
});

export const tChorusWide = (a: number, b: number, cs: Chunk[], o: {gold?: boolean; confetti?: boolean; dutch?: number; glow?: boolean; jump?: number; reverse?: boolean} = {}): Part => {
  // looking up from the audience: a strong dutch angle, the three high in the frame, penlights filling the lower
  // part; one direction for the whole chorus (the picture travels left, as the reference pan), fast in, slow
  // but moving, whipping out into the solo in the same direction
  const side = o.reverse ? -1 : 1;
  const roll = o.dutch ?? 0.12 * side;
  // v32: opposite camera angle and travel only. Character artwork and LAY_CH stay unchanged.
  const rig = glide(a, b, {x: o.reverse ? 1140 : 1010, y: 600, z: 1.05, r: roll}, {dir: [-side, 0], px: 70, rot: -0.006 * side, zoom: 0.012, inK: 12, outK: 34, tauOut: 0.27}); // the exit accelerates earlier and goes farther (user)
  // faces follow the phrases: soft, wink, laugh (and back to wink / laugh on longer lines)
  // one face change, at the top of a jump of the three on the second phrase (a full-body moment, not a swap)
  const jumpT = o.jump ?? (cs[1] ?? cs[0]).t - 0.1;
  const face = faces([{t: a, k: 'full_soft'}, {t: jumpT + 0.22, k: 'full_laugh'}]);
  // (v15, user: the chorus faces over-exposed) the glow of chorus 3 is light of the stage: it now sits behind
  // the three instead of being screened over their faces (it lifted their dark lines by 0.15)
  const sc: StageScene = {members: LAY_CH, pen: 1.7, penBeats: 8, light: true, /* (v15, user: not faster in the chorus either) */ face, hop: hops([jumpT], ['mew', 'popy', 'halo']), extra: (g, T) => confetti(g, T, a), back: o.glow ? (g, T) => glowTop(g, T, 3, rig(T)) : undefined};
  const part = stageShots([{a, b, label: 'chorus wide', scene: sc, rig}], {grade: CHORUS_GRADE});
  // the lights of the stage flare into the lens; they belong to the stage (scene points through the camera)
  part.shots.push(stageFlares(a, b, rig));
  part.shots.push(subtitleShot(cs, a, b));
  return part;
};

const confetti = (g: CanvasRenderingContext2D, T: number, t0: number) => {
  const cols = ['#ffffff', '#ffd1e6', '#d9c3ff', '#fff1b8', '#bfe8ff'];
  for (let i = 0; i < 80; i++) {
    const lt = T - t0 - rnd(31, i) * 1.4;
    if (lt < 0) continue;
    const x = rnd(32, i) * 2800 - 200 + Math.sin(lt * 2 + i) * 50;
    const y = -80 + lt * (200 + rnd(33, i) * 180);
    if (y > 1300) continue;
    const s = 12 + rnd(34, i) * 12;
    const sp = lt * (4 + rnd(35, i) * 4) + i;
    g.save();
    g.translate(x, y);
    g.rotate(sp * 0.3);
    g.scale(1, Math.abs(Math.cos(sp)) * 0.9 + 0.1);
    g.fillStyle = cols[i % cols.length];
    g.fillRect(-s / 2, -s * 0.35, s, s * 0.7);
    g.restore();
  }
};

// ---------------------------------------------------------------- solo lines: high-key, heavily soft close-ups

export type SoloCut = {a: number; b: number; m: Member; k: Kind; kind: 'costume' | 'arm' | 'upper' | 'legs' | 'faces'; with?: Member};

/** Solo lines on a white, high-key ground. Each cut: arrives fast (soft), sharp and slow in the middle,
 *  leaves fast (soft). A sunlight flare keeps moving in front. */
export const tSolo = (cuts: SoloCut[], cs: Chunk[]): Part => {
  const t0 = cuts[0].a;
  const shots: Shot[] = cuts.map((c, i) => {
    // framing per kind: face position on screen, face height, drift (screen px/s) and entry direction
    const F: Record<SoloCut['kind'], {x: number; y: number; f: number; vx: number; vy: number}> = {
      costume: {x: 900, y: -260, f: 760, vx: -70, vy: 10},
      arm: {x: 1300, y: -40, f: 620, vx: 15, vy: -90},
      upper: {x: 1050, y: 300, f: 380, vx: -15, vy: 55},
      legs: {x: 960, y: -760, f: 400, vx: 10, vy: 60},
      faces: {x: 960, y: 420, f: 360, vx: 35, vy: 8},
    };
    const p = F[c.kind];
    const ent = [{dx: -500, r: -0.12}, {dy: 380, r: 0.1}, {dx: 420, r: 0.08}][i % 3];
    const ex = [{dx: 600, r: 0.12}, {dy: -420, r: -0.08}, {dx: -600, r: -0.1}][i % 3];
    return {
      a: c.a,
      b: c.b,
      label: `solo ${c.kind} ${c.m}`,
      draw: (ctx, T) => {
        const lt = T - c.a;
        // U-shaped speed: exponential arrival (tau 0.11 s), a slow push / drift / roll through the middle,
        // exponential acceleration out over the last 0.3 s; tilted a little, like a view from the audience
        const ein = Math.exp(-lt / 0.11);
        // (v16, user: the last one starts leaving too late, and the speed had a step) the exit ramp starts from
        // the drift without a kink (exp(u/tau) - 1 - u/tau: zero extra speed at its start) and, for the cut into
        // 爆レス, begins 1.1 s before the cut so the acceleration is seen
        // (v17, user: the last one left slower than the two before) every cut ends on the same fast exit (0.3 s,
        // tau 0.09, the same speed at the cut); the last one adds a slow lead-in ramp from 1.1 s before the cut
        // on top, so it starts moving early and still leaves as fast as the others
        const last = i === cuts.length - 1;
        const ramp = (x: number, tau: number) => Math.exp(x / tau) - 1 - x / tau;
        const uf = T - (c.b - 0.3);
        const gout = uf > 0 ? ramp(Math.min(uf, 0.3), 0.09) / ramp(0.3, 0.09) : 0;
        const us = T - (c.b - 1.1);
        const glead = last && us > 0 ? ramp(Math.min(us, 1.1), 0.36) / ramp(1.1, 0.36) : 0;
        const lead = {dx: -240, r: -0.05};
        const ox = (ent.dx ?? 0) * ein + (ex.dx ?? 0) * gout + lead.dx * glead;
        const oy = (ent.dy ?? 0) * ein + (ex.dy ?? 0) * gout;
        const tiltS = i % 2 ? 1 : -1;
        const rot = ent.r * ein + ex.r * gout + lead.r * glead + 0.04 * tiltS - 0.012 * tiltS * lt;
        const zoom = (1 + 0.035 * lt) * (1 + 0.12 * ein + 0.1 * gout);
        const blur = 32 * Math.max(ein, gout); // user: stronger soft focus at the cuts
        ctx.fillStyle = '#fff9fc';
        ctx.fillRect(0, 0, W, H);
        const {c: lc, g} = layer('soloL');
        g.save();
        g.translate(960 + ox, 540 + oy);
        g.rotate(rot);
        g.scale(zoom, zoom);
        g.translate(-960, -540);
        const dx = p.vx * lt;
        const dy = p.vy * lt;
        if (c.kind === 'faces') {
          // (v17, user: HALO's hat ribbon covered MEW's face) wider apart, and the one on the right is drawn first
          // so the left one's face stays in front of anything hanging off the other's head
          const pair = [c.m, c.with ?? c.m];
          [1, 0].forEach((j) => {
            const m = pair[j];
            // (they used to drift toward each other: now a little apart)
            figAt(g, m, m === 'mew' ? 'full' : c.k, (j ? 1400 : 540) + dx * (j ? 0.4 : -0.4), p.y + dy, p.f);
          });
        } else figAt(g, c.m, c.kind === 'legs' || (c.m === 'mew' && c.kind !== 'costume') ? 'full' : c.k, p.x + dx, p.y + dy, p.f);
        g.restore();
        drawBlurred(ctx, lc, Math.max(0.6, blur));
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        // (v19, user: on the MEW + HALO faces cut the white wash on the left hid MEW's face) there it only
        // touches the very edge of the frame
        const lg = ctx.createLinearGradient(0, 0, c.kind === 'faces' ? 170 : 820, 0);
        lg.addColorStop(0, `rgba(255,255,255,${c.kind === 'faces' ? 0.5 : 0.85})`);
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        // (v45, user: back to the v43 particles, only their own drift faster)
        // (v43, user: the particles must move with the camera) they float in the air between the camera and her:
        // the same move as the picture (arrival, drift, roll, push, exit), a little stronger (nearer the lens), over
        // a field larger than the frame so no edge goes empty
        // (v46, user: near ones move more with the camera, far ones less - almost with the picture) depth bands:
        // each band follows the camera by its own factor (far ~1 = the figure's plane, near > 1), small far, big near
        {
          const SP = SOLO_PARTICLES;
          const nb = Math.max(1, SP.bands);
          for (let k = 0; k < nb; k++) {
            const u = nb === 1 ? 1 : k / (nb - 1);
            const par = lerp(SP.far, SP.near, u);
            const pad = SP.pad * Math.max(1, par / 1.15);
            const zp = Math.pow(zoom, par);
            const area = ((W + 2 * pad) * (H + 2 * pad)) / (W * H);
            const size: [number, number] = [lerp(SP.sizeFar[0], SP.sizeNear[0], u), lerp(SP.sizeFar[1], SP.sizeNear[1], u)];
            ctx.save();
            ctx.translate(960 + ox * par, 540 + oy * par);
            ctx.rotate(rot * par);
            ctx.scale(zp, zp);
            ctx.translate(-960 + dx * par, -540 + dy * par);
            bokehField(ctx, T, 1500 + i * 10 + k, ['#ffffff', '#ffd6ea', '#fff0c0'], [{n: Math.max(1, Math.round((SP.count / nb) * area)), size, blur: 0.5, alpha: 0.7, speed: SP.drift}], {x: 0, y: 0}, pad);
            ctx.restore();
          }
        }
        const lt0 = T - t0;
        // (user: the moving sun flare looked cheap) a film light leak: warm light breathing in from the top-left
        // corner and bleeding along the top edge, slowly drifting; no ghosts, no streaks
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'screen';
        const br = 0.55 + 0.25 * Math.sin(lt0 * 0.9) + 0.1 * Math.sin(lt0 * 2.3);
        const lx = -150 + Math.sin(lt0 * 0.35) * 120;
        const ly = -120 + Math.cos(lt0 * 0.3) * 60;
        const leak = ctx.createRadialGradient(lx, ly, 0, lx, ly, 1100);
        leak.addColorStop(0, `rgba(255,236,205,${0.95 * br})`);
        leak.addColorStop(0.35, `rgba(255,190,150,${0.5 * br})`);
        leak.addColorStop(0.7, `rgba(255,150,170,${0.18 * br})`);
        leak.addColorStop(1, 'rgba(255,150,170,0)');
        ctx.fillStyle = leak;
        ctx.fillRect(0, 0, W, H);
        const tg = ctx.createLinearGradient(0, 0, 0, 260);
        tg.addColorStop(0, `rgba(255,220,190,${0.35 * br})`);
        tg.addColorStop(1, 'rgba(255,220,190,0)');
        ctx.fillStyle = tg;
        ctx.fillRect(0, 0, W, 260);
        ctx.restore();
        if (i === cuts.length - 1) {
          const k = prog(T, c.b - 0.12, c.b);
          if (k > 0) {
            ctx.save();
            ctx.globalAlpha = k;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1;
            glow(ctx, 1150, 480, 380, '#ffe066', k * 0.9);
            ctx.restore();
          }
        }
      },
    };
  });
  shots.push(subtitleShot(cs, cuts[0].a, cuts[cuts.length - 1].b, {y: 965, style: SOLOSUB}));
  return {shots, fx: [grade(cuts[0].a, cuts[cuts.length - 1].b, {...CHORUS_GRADE, bloom: 0.12, threshold: 0.93, vignette: 0} /* (v15) no lift: it washed POPY out; (v16) brighter, the chorus may glow */)]};
};

// ---------------------------------------------------------------- 爆レス (zoom out from the faces, giant columns behind, love bubbles flying up)

// the three close together in the middle (overlapping a little), leaving the edges to the words
const LAY_BK: Mem[] = [
  {m: 'mew', x: 735, fy: 300, f: 100},
  {m: 'halo', x: 1185, fy: 300, f: 100},
  {m: 'popy', x: 960, fy: 335, f: 98},
];
/** (v16, user: the three 爆レス must not be the same) one build over the song, same frame. (v17, user) the hearts
 *  take the colours of the three チュッ in order: purple (MEW), yellow (HALO), red (POPY).
 *   0  first time - the base: purple hearts, the usual count and speed, the pull back from the faces;
 *   1  怖いものはないよ - reassuring: fewer, bigger, slower yellow hearts, the camera turning the other way and
 *      pulling back slower, the columns rising slower, the three smiling softly;
 *   2  the last time - the fullest: red hearts, more and faster, more near ones, a closer start and a harder
 *      pull back, the columns slamming in, the glow on top. */
export const tBakures = (a: number, b: number, right: Chunk, left: Chunk, o: {glow?: boolean; v?: 0 | 1 | 2} = {}): Part => {
  const v = o.v ?? 0;
  const V = [
    {tau: 1.45, z0: 1.45, r0: 0.05, rEnd: -0.03, n: 1, sp: 1, sc: 1, near: 2, cols: [COLORS.mew.main, '#b48cff', '#9a6cf5', '#c9a8ff', COLORS.mew.deep], fx: 'rise' as WordFx, step: 0.08, face: 'full_laugh' as Kind},
    {tau: 2.0, z0: 1.3, r0: -0.05, rEnd: 0.03, n: 0.75, sp: 0.7, sc: 1.15, near: 2, cols: [COLORS.halo.main, '#ffd06a', '#f6c443', '#ffb84d', '#e8a312'], fx: 'rise' as WordFx, step: 0.12, face: 'full_wink' as Kind},
    {tau: 1.15, z0: 1.9, r0: 0.07, rEnd: -0.035, n: 1.4, sp: 1.25, sc: 1, near: 3, cols: [COLORS.popy.main, '#ff3d5c', RED_H, '#ff6f8a', COLORS.popy.deep], fx: 'slam' as WordFx, step: 0.07, face: 'full_laugh' as Kind},
  ][v];
  const rig: Rig = (T) => {
    const e = Math.exp(-Math.max(0, T - a) / V.tau);
    return {x: 960, y: 560 - 170 * e, z: 1 + V.z0 * e, r: V.rEnd + (V.r0 - V.rEnd) * e};
  };
  const r = layoutVert(right.gs, {size: 270, x: 1660, y: 130});
  const l = layoutVert(left.gs, {size: 270, x: 262, y: 300});
  const rightAt = a + 0.15;
  const leftAt = Math.max(rightAt, left.t - 0.1);
  const column = (g: Ctx, ps: Placed[], T: number, at: number, refAt: number, seed: number, grow = 1) => {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    view(g, rig(refAt), 0.3);
    const reference = g.getTransform();
    guardFrame(g, ps);
    // One fixed framing correction: unlike per-frame clamping, this cannot cancel camera motion.
    // (v32, user: the right column a little bigger) grown about the frame centre after the fit
    const fitted = g.getTransform();
    // grown about the top of the column: the first glyph keeps its place, the column gets longer downwards
    const cx = ps.reduce((q, p) => q + p.x, 0) / ps.length;
    const cy = Math.min(...ps.map((p) => p.y - p.size * 0.5));
    const C = fitted.transformPoint(new DOMPoint(cx, cy));
    const fit = new DOMMatrix().translate(C.x, C.y).scale(grow, grow).translate(-C.x, -C.y).multiply(fitted.multiply(reference.inverse()));
    g.setTransform(1, 0, 0, 1, 0, 0);
    view(g, rig(T), 0.3);
    g.setTransform(fit.multiply(g.getTransform()));
    glyphWord(g, ps, T, at, BIG, V.fx, {step: V.step, seed, noGuard: true}); // (v31, user: dull, and no red edge - the サイリウム lettering) BIGP -> BIG
    g.restore();
  };
  const colsText = (g: Ctx, T: number) => {
    // Right starts closer and recedes from its first frame; left keeps its rising entrance throughout.
    column(g, r, T, rightAt, rightAt + 0.55, 41, BAKURES.rightScale);
    column(g, l, T, leftAt, leftAt, 43);
  };
  const N = (k: number) => Math.max(1, Math.round(k * V.n));
  const bub = {colors: V.cols, scale: V.sc};
  const sc: StageScene = {
    members: LAY_BK,
    pen: 1.1,
    light: true,
    face: () => V.face,
    // (v31, user: the columns looked dull) drawn after the stage's haze and soft edges; (v32, user) over the three
    overFront: (g, T) => colsText(g, T),
    back: (g, T) => {
      if (o.glow) glowTop(g, T, 5, rig(T)); // (v15) behind the three, not over their faces
      loveBubbles(g, T, a - 2, 'far', {seed: 21, speed: 110 * V.sp, n: N(16), ...bub});
    },
    extra: (g, T) => {
      loveBubbles(g, T, a - 2, 'mid', {seed: 22, speed: 170 * V.sp, n: N(5), area: {x: -100, w: 620}, ...bub});
      loveBubbles(g, T, a - 2, 'mid', {seed: 24, speed: 170 * V.sp, n: N(5), area: {x: 1400, w: 620}, ...bub});
    },
  };
  const part = stageShots([{a, b, label: 'bakures', scene: sc, rig, whiteIn: 0.3}], {grade: CHORUS_GRADE});
  part.shots.push({
    a,
    b,
    z: 5,
    label: 'bakures near bubbles',
    draw: (ctx, T) => {
      loveBubbles(ctx, T, a - 2, 'near', {seed: 23, speed: 260 * V.sp, n: V.near, area: {x: -150, w: 500}, ...bub});
      loveBubbles(ctx, T, a - 2, 'near', {seed: 25, speed: 260 * V.sp, n: V.near, area: {x: 1570, w: 500}, ...bub});
    },
  });
  return part;
};

// ---------------------------------------------------------------- single members on the darker stage (B3)

/** A hexagonal aperture ghost (lens flare). */
const hexGhost = (ctx: Ctx, x: number, y: number, r: number, col: string, a: number) => {
  if (a <= 0.003) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.26); // the aperture's orientation is fixed: every ghost is turned the same way
  ctx.beginPath();
  for (let i = 0; i < 6; i++) ctx.lineTo(Math.cos((i * Math.PI) / 3) * r, Math.sin((i * Math.PI) / 3) * r);
  ctx.closePath();
  const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  g.addColorStop(0, hexA(col, a * 0.5));
  g.addColorStop(0.85, hexA(col, a));
  g.addColorStop(1, hexA(col, a * 0.6));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
};

/** Sun-like lens ghosts for a light at screen point (lx, ly): hexagons on the line from the light through the
 *  centre of the frame (as in a real lens), so they slide the opposite way to the light as the camera moves. */
const lensGhosts = (ctx: Ctx, lx: number, ly: number, k: number) => {
  const cx = W / 2;
  const cy = H / 2;
  const G: [number, number, string, number][] = [
    [0.35, 46, '#ffd6f0', 0.2],
    [0.62, 92, '#c9b6ff', 0.14],
    [1.0, 34, '#fff0b0', 0.24],
    [1.35, 128, '#b6f0ff', 0.1],
    [1.8, 64, '#ffc8e8', 0.16],
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  G.forEach(([s, r, col, al]) => hexGhost(ctx, cx + (cx - lx) * s, cy + (cy - ly) * s, r * (0.7 + 0.6 * Math.min(1, k)), col, al * Math.min(1, k)));
  ctx.restore();
};

/** A cut carried by a stage lamp (v16; v17, user: the lamp looked stuck on, not part of the stage): over the last
 *  0.6 s the outgoing camera tilts up into the overhead truss; the fixture it heads for (a real lamp drawn on the
 *  truss, seen through the camera) flares and its light floods the lens at the cut, with hexagonal ghosts on the
 *  line through the centre (they slide against the lamp as the camera moves). After the cut the light drains out
 *  of the top of the frame while the next shot is already moving up; the ghosts drift down and fade with it. */
export const lampCut = (at: number, rig: Rig, col = '#fff0fb', lampY = RIG_LAMP_Y): Shot => {
  const lampX = rigLampX(rig(at).x);
  const proj = (T: number) => {
    const c = rig(T);
    const q = [(lampX - c.x) * c.z, (lampY - c.y) * c.z];
    return [W / 2 + Math.cos(c.r) * q[0] - Math.sin(c.r) * q[1], H / 2 + Math.sin(c.r) * q[0] + Math.cos(c.r) * q[1]];
  };
  return {
    a: at - 0.7,
    b: at + 0.32,
    z: 9,
    label: 'lamp cut',
    draw: (ctx, T) => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (T < at) {
        const [lx, ly] = proj(T);
        const k = Math.exp((T - at) / 0.08); // (v19: 0.14 -> 0.08, the fixtures stay visible until just before the flood)
        lensFlare(ctx, lx, ly, 0.5 + 1.5 * k, '#ffe2f4');
        lensGhosts(ctx, lx, ly, 0.3 + 0.9 * k);
        ctx.globalCompositeOperation = 'screen';
        const r = 260 + 2000 * k;
        const gg = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        gg.addColorStop(0, hexA(col, Math.min(1, 1.2 * k)));
        gg.addColorStop(0.45, hexA(col, 0.85 * k));
        gg.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = gg;
        ctx.fillRect(0, 0, W, H);
      } else {
        const u = (T - at) / 0.32;
        const k = Math.pow(1 - u, 2);
        // the lamp is now above the frame and going further up (the new shot keeps tilting up)
        const lx = W / 2;
        const ly = -80 - 900 * u;
        const gr = ctx.createLinearGradient(0, -200, 0, H * (1.2 - 0.9 * u));
        gr.addColorStop(0, hexA(col, k));
        gr.addColorStop(0.6, hexA(col, 0.8 * k));
        gr.addColorStop(1, hexA(col, 0));
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
        lensFlare(ctx, lx, ly + 120, 1.5 * k, '#ffe2f4');
        lensGhosts(ctx, lx, ly, 1.2 * k);
      }
      ctx.restore();
    },
  };
};

/** (v20, user: one stage, no sudden change of speed, accelerating up to the lamp, only up - no pulling back)
 *  The camera only travels up along its own vertical (the picture moves straight down on screen), at a
 *  constant zoom, until its centre is on the lamp line at `b`.
 *  (v21, user: the acceleration started too early and the start was already fast; accelerate only from the
 *  last three sung notes) a slow drift (v0 px/s) until `accelAt`, then an exponential on top of it,
 *  K (e^(s/tau) - 1 - s/tau): speed and acceleration both start from the drift's, so the speed never jumps;
 *  K is whatever reaches the lamp line at `b`. */
const tiltUp = (a: number, b: number, base: Cam, o: {v0: number; tau: number; accelAt: number; lampY: number}): Rig => {
  const D = b - a;
  // the camera's own up, in the stage's coordinates
  const ux = -Math.sin(base.r);
  const uy = -Math.cos(base.r);
  const dist = (base.y - o.lampY) / -uy;
  const Ta = Math.max(0.2, b - o.accelAt);
  const ex = (s: number) => (s > 0 ? Math.exp(s / o.tau) - 1 - s / o.tau : 0);
  const K = Math.max(0, dist - o.v0 * D) / ex(Ta);
  return (T) => {
    const t = clamp(T - a, 0, D);
    const d = o.v0 * t + K * ex(t - (D - Ta));
    return {x: base.x + ux * d, y: base.y + uy * d, z: base.z, r: base.r};
  };
};

/** (v21, user: the lamps hung so high that the camera had to leave the singer early to reach them) the lamps
 *  over the dark B3 stage hang lower than RIG_LAMP_Y. (v22, user: now too low) -470 -> -950: 1250 above the
 *  faces, about one figure height above their heads. Only the singles use it; every other stage shot keeps
 *  RIG_LAMP_Y. */
const SINGLES_LAMP_Y = -750;

/** (v25, user: the three singles must start accelerating the same time before the cut) the tilt up of every
 *  single starts accelerating SINGLES_ACCEL_LEAD seconds before its cut (b). Bigger = earlier start and a gentler
 *  cut speed; smaller = later start and a faster cut. (Before v25 it followed the notes of each line, which
 *  gave 0.74 / 0.70 / 0.58 s.) */
const SINGLES_ACCEL_LEAD = 0.9;

/** (v22, user: moving lens flares on the lamps) every ceiling lamp near or in the frame flares into the lens:
 *  a core and streak at the lamp (seen through the camera, so it slides down the frame as the camera tilts
 *  up) and hexagonal ghosts on the line through the centre (they slide the other way). They swell as the lamp
 *  comes in from above the frame. The lamp the cut heads for is lampCut's (excluded here). */
const lampFlares = (a: number, b: number, rig: Rig, lampY: number, col = '#ffe2f4'): Shot => {
  const target = rigLampX(rig(b).x);
  return {
    a,
    b,
    z: 8,
    label: 'lamp flares',
    draw: (ctx, T) => {
      const c = rig(T);
      const xs: number[] = [];
      for (let X = rigLampX(c.x - 2600); X <= c.x + 2600; X += RIG_DX) if (Math.abs(X - target) > 1) xs.push(X);
      xs.forEach((X, i) => {
        const q = [(X - c.x) * c.z, (lampY - c.y) * c.z];
        const sx = W / 2 + Math.cos(c.r) * q[0] - Math.sin(c.r) * q[1];
        const sy = H / 2 + Math.sin(c.r) * q[0] + Math.cos(c.r) * q[1];
        const near = clamp((sy + 420) / 520) * clamp((W + 500 - Math.abs(sx - W / 2) * 2) / 900);
        if (near <= 0) return;
        const k = near * (0.42 + 0.1 * Math.sin((2 * Math.PI * T) / (8 * BEAT) + i * 1.7));
        lensFlare(ctx, sx, sy, k, col);
        lensGhosts(ctx, sx, sy, 0.6 * k);
      });
    },
  };
};

/** (v19, user: a transition at the cut from B3's サイリウム pull back into chorus 3) white rises over the last
 *  0.3 s of the accelerating pull back, peaks on the cut, and drains out of the new shot in 0.35 s. */
export const flashCut = (at: number, pre = 0.3, post = 0.35): Part => ({
  shots: [
    {
      a: at - pre,
      b: at + post,
      z: 9,
      label: 'flash cut',
      draw: (ctx, T) => {
        const v = T < at ? Math.pow(prog(T, at - pre, at), 1.7) : Math.pow(1 - prog(T, at, at + post), 1.4);
        if (v <= 0) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = Math.min(1, v);
        ctx.fillStyle = '#fff8fc';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      },
    },
  ],
  fx: [],
});

export const tStageSingles = (items: {m: Member; a: number; b: number; c: Chunk}[], o: {next?: {m: Member; c: Chunk; pos: [number, number][]}; around?: {c: Chunk; pos: [number, number][]; designAt?: number}; end?: number} = {}): Part => {
  const list: StageShot[] = items.map((it, i) => {
    const lay: Mem[] = [{m: it.m, x: i % 2 ? 1120 : 820, fy: 300, f: 165}];
    const f = faceAt(lay, it.m);
    // camera: the same for the three (logic: each shot pushes toward the singer while tilting up her body):
    // the picture travels down and grows; fast in, slow in the middle, accelerating push out
    const base = {x: f.x, y: f.y + 230, z: 1.05, r: i % 2 ? 0.05 : -0.05};
    // (v16, user: no transition between the singles) each one ends tilting up into the lamps over the stage
    // (the way it was already moving: the picture travels down), faster and faster, until a lamp flares
    // into the lens; the next one comes out of that light still moving up (see lampCut)
    // (v19, user: the truss hung too low) it is now twice as high, 2100 above the singer: the tilt up to it
    // starts 1.1 s before the cut and keeps accelerating (quadratic, so the truss is in the frame for the last
    // ~0.2 s instead of one frame); it widens to 0.55x on the way up so the rig comes into view sooner and
    // reads as the rig over the stage; the lamp it heads for is in the centre of the frame at the cut
    // (v20, user: one stage, accelerating, only up, no pull back) one tilt from the singer (face above the
    // centre) straight up to the lamp line
    // (v21, user: accelerate only from the last three sung notes; the start too fast) 30 px/s until the third
    // last note, then the exponential (~4000 px/s at the cut); the truss hangs lower here, so the face stays
    // in the frame almost to the cut
    const accelAt = it.b - SINGLES_ACCEL_LEAD; // (v25) the same lead before the cut for all three
    // (v22: the lamps higher again, -950; tau 0.25 -> 0.5 so the speed at the cut stays ~3600-4600 px/s)
    const rig = tiltUp(it.a, it.b, base, {v0: 55, tau: 0.25, accelAt, lampY: SINGLES_LAMP_Y});
    return {
      a: it.a,
      b: it.b,
      label: `single ${it.m}`,
      scene: {members: lay, dark: true, pen: 1.1, light: true, face: () => 'full_soft', rigY: SINGLES_LAMP_Y},
      rig,
      bgBlur: 14,
    };
  });
  const part = stageShots(list, {dark: true});
  part.shots.push(subtitleShot(items.map((it) => it.c), items[0].a, items[items.length - 1].b));
  list.forEach((s) => part.shots.push(lampFlares(s.a, s.b, s.rig, SINGLES_LAMP_Y), lampCut(s.b, s.rig, undefined, SINGLES_LAMP_Y)));
  if (o.next && o.around && o.end) {
    const a = items[items.length - 1].b;
    const f = faceAt(LAY_B, o.next.m);
    const backT = o.around.c.t - 0.1;
    // 君の close on POPY, then one long spiral pull back (turning clockwise) that reveals the other two, the
    // ring of penlights and the stage; it keeps travelling down like the singles before it
    // (user: too low; harder pull back out) (v15, user: too fast through the middle, the pull back must not reach
    // the edge of the stage) slower middle (px 60 -> 32, zoom -0.3 -> -0.16), the same speed at the cut
    const rig0 = glide(a, o.end, {x: f.x, y: f.y + 215, z: 1.5, r: -0.06}, {dir: [0, 1], px: 32, rot: 0.032, zoom: -0.16, inK: 10, outK: 36, tauOut: 0.17, at: backT + 0.2});
    // (v17, user: the audience here looked different from the B1 / B2 pull backs) the same dolly back as the B1 /
    // B2 carousel at サイリウム (x0.72, tau 0.25) and the same density of near penlights, so the crowd shows the
    // same way below the three
    // (the glide's own hard exit then pulls back on top; a soft floor keeps the end at the B1 / B2 carousel's
    // ~0.45x instead of 0.27x, which showed past the crowd)
    const rig: Rig = (T) => {
      const c = rig0(T);
      const kb = 1 - Math.exp(-Math.max(0, T - backT) / 0.25);
      const z = c.z * lerp(1, 0.75, kb);
      return {...c, z: Math.pow(Math.pow(z, 4) + Math.pow(0.42, 4), 0.25)};
    };
    const nx = o.next;
    const ar = o.around;
    const p2 = stageShots([
      {
        a,
        b: o.end,
        label: 'B3 kimino / sairiumu',
        scene: {members: LAY_B, pen: 0.9, light: true, face: () => 'full_wink'},
        rig,
        text: (ctx, T) => {
          if (T < ar.c.t - 0.12) scatter(ctx, nx.c.gs, T, nx.c.t - 0.12, nx.pos, 420, ar.c.t - 0.12);
          else {
            // (v35, user) サイリウム goes back with the camera's pull back
            // (v44, user: the v42 layout - same letters, same size, same arrangement - only moved off the people)
            // the positions are given as seen at `designAt` (3:01) and carried back through the camera's own move
            // to where they are laid out; they move with the stage, so they stay clear of the three all through
            const ref = ar.c.t - 0.12 + SAIRIUM.settle;
            const fol = SAIRIUM.follow > 0 ? followM(rig, ref, T, SAIRIUM.follow) : undefined;
            let pos = ar.pos;
            if (ar.designAt !== undefined && SAIRIUM.follow > 0) {
              const back = followM(rig, ref, ar.designAt, SAIRIUM.follow).inverse();
              pos = ar.pos.map(([x, y]) => {
                const q = back.transformPoint(new DOMPoint(x, y));
                return [q.x, q.y] as [number, number];
              });
            }
            scatter(ctx, ar.c.gs, T, ar.c.t - 0.12, pos, 360, undefined, 'fly', fol, ar.designAt !== undefined);
          }
        },
      },
    ]);
    part.shots.push(...p2.shots);
    part.fx.push(...p2.fx);
  }
  return part;
};

// ---------------------------------------------------------------- bridge: empty stage with lines, then the big words

const BRIDGE_WIDE_SCALE = 0.90; // v51: centre framing is 10% farther out, including lyric columns.

/** (v32) 2:46 arrival from the upper right: time constant (s) of the exponential settle onto the middle path.
 *  Smaller = faster arrival (and a faster first frame); bigger = longer glide. ~95 % arrived after 3 x TAU. */
const BRIDGE_ARRIVE = {TAU: 0.3};
/** v38: slower upper-right arrival without rebounds; original middle/exit path from 1.4 s on. */
const bridgeSteady = (a: number, b: number): Rig => {
  const join = a + 1.4;
  // The first key supplies the original tangent at the join; it is never played.
  const continuation = flow([
    {t: a + 1.05, cam: {x: 944, y: 549.9, z: 1.042, r: -0.0125}},
    {t: join, cam: {x: 962, y: 540, z: 1.04, r: -0.012}},
    {t: b - 0.6, cam: {x: 930, y: 470, z: 1.2, r: 0.03}},
    {t: b, cam: {x: 925, y: 455, z: 1.24, r: 0.034}},
  ]);
  // (v32, user: at 2:47-48 the two moves did not flow into each other - measured: a hard brake at 0.4 s, then
  // y and zoom turned back at the join) ONE move instead of two: the camera is the middle path plus an offset
  // from the upper right that dies away exponentially (BRIDGE_ARRIVE.TAU). The speed only falls from the cut,
  // with no corner anywhere; where the slow path goes the other way the turn is a gentle curve, not a stop.
  // (the old first key at a + 1.05 made the path swing right then left around the join - it is left out: the
  // middle path starts at the join and is carried back from there along its own tangent)
  const middle = flow([
    {t: join, cam: {x: 962, y: 540, z: 1.04, r: -0.012}},
    {t: b - 0.6, cam: {x: 930, y: 470, z: 1.2, r: 0.03}},
    {t: b, cam: {x: 925, y: 455, z: 1.24, r: 0.034}},
  ]);
  void continuation;
  const k0 = join;
  const c0 = middle(k0);
  const c1 = middle(k0 + 0.001);
  const vk = [(c1.x - c0.x) / 0.001, (c1.y - c0.y) / 0.001, (Math.log(c1.z) - Math.log(c0.z)) / 0.001, (c1.r - c0.r) / 0.001];
  // the middle path, carried back before its first key along its own tangent (so it has no kink there)
  const path = (T: number): number[] => {
    if (T >= k0) {
      const c = middle(T);
      return [c.x, c.y, Math.log(c.z * BRIDGE_WIDE_SCALE), c.r];
    }
    const d = T - k0;
    return [c0.x + vk[0] * d, c0.y + vk[1] * d, Math.log(c0.z * BRIDGE_WIDE_SCALE) + vk[2] * d, c0.r + vk[3] * d];
  };
  const start = [1520, 330, Math.log(1.55), -0.12];
  const off = path(a).map((v, i) => start[i] - v);
  const base: Rig = (T) => {
    const e = Math.exp(-Math.max(0, T - a) / BRIDGE_ARRIVE.TAU);
    const v = path(T).map((p, i) => p + off[i] * e);
    return {x: v[0], y: v[1], z: Math.exp(v[2]), r: v[3]};
  };
  return intoCut(base, b, {dur:1.1, tau:0.22, dy:-1220, zoom:1.04});
};
/** (v29, user: 素晴らしい / 景色だ！ should not vanish when sung but slide out of the bottom of the frame with the
 *  three as the camera tilts up) once they have landed the words move with the stage (as if they stood on it):
 *  FOLLOW = how much of the stage's movement on screen they take (1 = exactly with the three; > 1 = faster,
 *  a little in front of them; 0 = fixed on the screen as before v27). */
const BRIDGE_WORDS_FOLLOW = 1;
/** (v30) glyph size of 素晴らしい / 景色だ！ (px; was 215 - the columns ran out of the bottom of the frame). */
/** (v31) top glyph centres of the two columns (right 素晴らしい, left 景色だ！) when they land. */
const BRIDGE_WORDS_Y = {right: 120, left: 190};
const BRIDGE_WORDS_SIZE = 186; // (v31, user: too small at 2:51) 160 -> 186; columns start higher (BRIDGE_WORDS_Y) so they stay in frame until the tilt up
/** Camera view as a matrix (the same as rig.ts view(), par 1). */
const viewM = (c: Cam) => new DOMMatrix().translate(W / 2, H / 2).rotate((c.r * 180) / Math.PI).scale(c.z, c.z).translate(-c.x, -c.y);
/** (v35) Screen-space words that move with the camera from `ref` on, as if they stood in the scene: k = 1 moves
 *  them exactly as the stage moves (camera pull back = they shrink with it), 0 = fixed on the screen. */
/** (v35) Screen-space words that move with the camera as if they stood in the scene: the screen-space matrix that
 *  carries the frame at `ref` to the frame at T (pull back = they shrink, the roll turns them, the travel moves
 *  them; k = 1 exactly as the stage's own plane, 0 = fixed on the screen, in between = part of the way).
 *  (v36/v37, user) applied from the moment the words appear, so they go back with the camera's slow drift right
 *  away; at `ref` they are exactly where they were laid out. */
const followM = (rig: Rig, ref: number, T: number, k: number) => {
  const M = viewM(rig(T)).multiply(viewM(rig(ref)).inverse());
  if (k === 1) return M;
  const p0 = new DOMPoint(W / 2, H / 2);
  const p1 = M.transformPoint(p0);
  const sc = Math.pow(Math.hypot(M.a, M.b), k);
  const ang = (Math.atan2(M.b, M.a) * 180) / Math.PI;
  return new DOMMatrix()
    .translate(p0.x + k * (p1.x - p0.x), p0.y + k * (p1.y - p0.y))
    .rotate(ang * k)
    .scale(sc, sc)
    .translate(-p0.x, -p0.y);
};


export const bridgeColumns = (ctx: Ctx, T: number, wide: Rig, right: Chunk, left: Chunk) => {
  if (T < right.t - 0.1) return;
  // 素晴らしい drops into the right column, 景色だ！ rises into the left one, each glyph on its own
  // (v30, user: the bottom glyphs were already out of the frame when they appeared - the frame guard is off
  // since v29) smaller, so both columns sit inside the frame when they land
  const r = layoutVert(right.gs, {size: BRIDGE_WORDS_SIZE, x: 1700, y: BRIDGE_WORDS_Y.right});
  const l = layoutVert(left.gs, {size: BRIDGE_WORDS_SIZE, x: 225, y: BRIDGE_WORDS_Y.left});
  // (v29) from when they appear, they move on screen as the stage does: M = view(now) * view(then)^-1
  const ref = right.t - 0.1;
  const reference = wide(ref);
  // Keep the old calibration: the wider camera also brings both columns inward.
  const M = viewM(wide(T)).multiply(viewM({...reference, z: reference.z / BRIDGE_WIDE_SCALE}).inverse());
  const p0 = new DOMPoint(960, 540);
  const p1 = M.transformPoint(p0);
  const sc = Math.pow(Math.hypot(M.a, M.b), BRIDGE_WORDS_FOLLOW);
  ctx.save();
  ctx.translate(p0.x + BRIDGE_WORDS_FOLLOW * (p1.x - p0.x), p0.y + BRIDGE_WORDS_FOLLOW * (p1.y - p0.y));
  ctx.scale(sc, sc);
  ctx.translate(-p0.x, -p0.y);
  glyphWord(ctx, r, T, right.t - 0.1, BIG, 'fly', {step: 0.07, seed: 51, noGuard: true});
  glyphWord(ctx, l, T, Math.max(right.t, left.t - 0.1), BIG, 'rise', {step: 0.08, seed: 53, noGuard: true});
  ctx.restore();
};

export const tBridgeStage = (a: number, mid: number, b: number, lines: Chunk[], words: {center: Chunk[]; right: Chunk; left: Chunk}, o: {faceAt?: number; wordsEnd?: number} = {}): Part => {
  // (v17, user: change the faces on the ば of すばらしい, with a performance) the three jump together and the faces
  // change at the top of the jump (one after another, as every jump here)
  const fT = o.faceAt ?? words.right.t - 0.1;
  // (v15, user: the acceleration and the cut both came late, the top speed too low) the exit is one
  // exponential ramp over the last 0.75 s (seen from early on), to ~7000 px/s on screen at the cut
  const empty = intoCut(glide(a, mid, {x: 960, y: 540, z: 1.12, r: -0.04}, {dir: [1, 0], px: 55, rot: 0.008, zoom: 0.01, inK: 6, outK: 3}), mid, {dur: 0.75, tau: 0.17, dx: -1100, rot: 0.12});
  // The same camera drives figures, stage, flares and following lyric columns.
  const wide = bridgeSteady(mid, b);
  const part = stageShots([
    {a, b: mid, label: 'bridge empty stage', scene: {members: [], pen: 1.6}, rig: empty, bgBlur: 22},
    {
      a: mid,
      b,
      label: 'bridge big words [path]',
      scene: {members: LAY_B, pen: 1, light: true /* (v32, user: 2:50 is a chorus stage too) */, face: faces([{t: mid, k: 'full_soft'}, {t: fT, k: 'full_laugh'}]), hop: hops([fT - 0.18])},
      rig: wide,
      whiteOut: [b - 0.3, b],
      text: (ctx, T) => {
        // v47: keep the v36 left offset for 嗚呼 / なんて only; columns use their own framing.
        ctx.save();
        ctx.translate(-120, 0);
        const c = words.center;
        c.forEach((w, i) => {
          const next = c[i + 1] ?? words.right;
          if (T < w.t - 0.1 || T >= next.t - 0.1) return;
          bigPhrase(ctx, w.gs, T, w.t - 0.1, {x: 960, y: 600, size: 330, until: next.t - 0.1, fx: i % 2 ? 'spin' : 'slam'});
        });
        ctx.restore();
        ctx.save();
        if (T >= words.right.t - 0.1) {
          bridgeColumns(ctx, T, wide, words.right, words.left);
        }
        ctx.restore();
      },
    },
  ]);
  part.shots.push(subtitleShot(lines, a, mid));
  // the stage's own lights (points on the truss seen through the camera) flare as it tilts up into them
  part.shots.push(stageFlares(mid, b, wide));
  return part;
};

// ---------------------------------------------------------------- interlude stage, outro credits, finale

/** (v26, user: the photo session ends accelerating the camera up) the tilt up into the truss lamps at its end:
 *  starts WIDE_UP_LEAD s before the cut (on top of the slow drift up, so the speed does not jump), exponential
 *  with WIDE_UP_TAU (smaller = slower start, harder finish), WIDE_UP_DIST stage px up by the cut. */
const WIDE_UP_LEAD = 1.4;
const WIDE_UP_TAU = 0.3;
const WIDE_UP_DIST = 750;

/** Interlude, part 2 (user: a performance, not another camera sweep): a photo session on the stage. The camera
 *  only eases in (never still); every two beats a camera flash fires - the frame flashes white, a flash flares
 *  from the photographer's side, and with each flash the three strike a new face (the flash is the transition);
 *  a viewfinder (corners, REC, shot counter) frames it. */
export const tStageWide = (a: number, b: number, shots?: number[]): Part => {
  const ex = (s: number) => (s > 0 ? Math.exp(s / WIDE_UP_TAU) - 1 - s / WIDE_UP_TAU : 0);
  const upK = WIDE_UP_DIST / ex(WIDE_UP_LEAD);
  const rig: Rig = (T) => {
    const t = T - a;
    const up = upK * ex(T - (b - WIDE_UP_LEAD));
    // (v42, user: start further back and push in to about the old framing) the push into the photo session:
    // from PHOTO_IN.startZoom of the old framing, fast at the cut (picking up the push of the light show) and easing
    // into the old slow drift
    const u = clamp(t / PHOTO_IN.dur);
    const kin = PHOTO_IN.startZoom + (1 - PHOTO_IN.startZoom) * (1 - Math.pow(1 - u, PHOTO_IN.power));
    return {x: 960, y: 530 - 14 * t - up, z: 1.08 * Math.exp(0.04 * t) * kin, r: -0.025 + 0.008 * t};
  };
  // (user: a quarter of the first speed) (v15, user: the second one on the beat at 2:33.64) explicit times
  const flashes: number[] = shots ? [...shots] : [];
  if (!shots) for (let t = a + 0.45; t < b - 0.35; t += 8 * BEAT) flashes.push(t);
  const FACES: Record<Member, Kind[]> = {
    mew: ['full_wink', 'full_laugh', 'full_kiss', 'full_smug', 'full_laugh', 'full_wink', 'full_soft', 'full_laugh'],
    popy: ['full_laugh', 'full_wink', 'full_smug', 'full_kiss', 'full_wink', 'full_laugh', 'full_kiss', 'full_wink'],
    halo: ['full_smug', 'full_kiss', 'full_laugh', 'full_wink', 'full_soft', 'full_kiss', 'full_laugh', 'full_laugh'],
  };
  const face = (m: Member, T: number): Kind => {
    let n = -1;
    flashes.forEach((t) => {
      if (T >= t) n++;
    });
    return n < 0 ? 'full' : FACES[m][n % FACES[m].length];
  };
  const part = stageShots([{a, b, label: 'interlude photo session', scene: {members: LAY_B, pen: 1.1, face, light: true /* (v42) */}, rig, whiteIn: 0.25}]);
  part.shots.push(stageFlares(a, b, rig));
  part.shots.push({
    a,
    b,
    z: 7,
    label: 'viewfinder',
    draw: (ctx, T) => {
      let n = 0;
      let last = -9;
      flashes.forEach((t) => {
        if (T >= t) {
          n++;
          last = t;
        }
      });
      const k = 1 - clamp((T - last) / 0.35);
      if (k > 0) lensFlare(ctx, 1650, 180, 0.6 + 0.9 * k, '#ffffff');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 6;
      const m = 70;
      const L = 90;
      [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + sy * L);
        ctx.lineTo(x, y);
        ctx.lineTo(x + sx * L, y);
        ctx.stroke();
      });
      ctx.font = `700 40px ${'"MPR"'}, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(`SHOT ${String(n).padStart(2, '0')}`, W - m - 230, m + 70);
      if (Math.floor((T - a) / (2 * BEAT)) % 2 === 0) {
        ctx.fillStyle = '#ff3d6e';
        ctx.beginPath();
        ctx.arc(m + 40, m + 56, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText('REC', m + 66, m + 70);
      ctx.restore();
    },
  });
  part.fx.push(...flashes.map((t) => flashAt(t, 0.25, 0.6)));
  return part;
};

export type CreditLine = {text: string; small?: boolean};
export const tStageCredits = (a: number, b: number, lines: (string | CreditLine)[], textFrom = a): Part => {
  // (v16) a small heading shows together with the line after it; the big lines come one after another
  const L = lines.map((l) => (typeof l === 'string' ? {text: l} : l));
  let cnt = 0;
  let y = 560;
  const lay = L.map((l, i) => {
    const k = cnt; // a heading takes the index of the line it heads
    if (!l.small) cnt++;
    if (l.small && i > 0) y += 24; // a little gap before a new role
    const yy = y;
    y += l.small ? 78 : 100;
    return {l, y: yy, k};
  });
  const part = stageShots([
    {a, b, label: 'end credits stage', scene: {members: [], pen: 1.5}, rig: glide(a, b, {x: 960, y: 540, z: 1.1, r: -0.03}, {dir: [-1, 0], px: 30, rot: -0.004, zoom: 0.02, inK: 8, outK: 1}), bgBlur: 20},
  ]);
  part.shots.push({
    a,
    b,
    z: 6,
    label: 'end credits text',
    draw: (ctx, T) => {
      lay.forEach(({l, y: ly, k}) => {
        const t0 = textFrom + 0.8 + 4 * BEAT + k * 1.3; // (user: one bar later; anchored, so an earlier cut does not move it)
        const big = !l.small;
        const gs = Array.from(l.text).map((ch) => ({ch, t: t0}));
        const ps = layoutLine(gs, {size: big ? 72 : 44, tracking: 0.04, align: 1, weight: 400});
        ctx.save();
        ctx.translate(1830, ly);
        drawFancy(ctx, ps, T, CREDIT, {kind: 'cascade', at: t0, step: 0.05, dur: 0.6, drop: 0.25}, {sparkle: ['#ffffff', '#ffd6ec']});
        ctx.restore();
      });
    },
  });
  return part;
};

export const tFinale = (a: number, whipEnd: number, fadeA: number, b: number, logo: (ctx: Ctx, cx: number, cy: number, sc: number, T: number, t0: number) => void): Part => {
  // ONE shot (user): close on MEW (left), the camera travels right past POPY to HALO, then pulls back to the
  // three in the centre with the title. A real camera path (spline: never stops), little motion blur.
  const fM = faceAt(LAY_B, 'mew');
  const fH = faceAt(LAY_B, 'halo');
  const tH = whipEnd - 0.05;
  const rig = flow([
    // (v15, user) a little longer on MEW before the move to HALO
    {t: a, cam: {x: fM.x - 20, y: fM.y + 150, z: 2.25, r: -0.06}},
    {t: a + 0.33, cam: {x: fM.x + 18, y: fM.y + 150, z: 2.23, r: -0.05}},
    {t: a + 0.73, cam: {x: fH.x - 35, y: fH.y + 150, z: 2.2, r: 0.03}},
    {t: tH, cam: {x: fH.x - 15, y: fH.y + 148, z: 2.18, r: 0.04}},
    {t: tH + 0.9, cam: {x: 1010, y: 560, z: 1.2, r: 0.02}},
    {t: tH + 2.4, cam: {x: 960, y: 545, z: 1.02, r: 0.0}},
    {t: b, cam: {x: 960, y: 528, z: 0.84, r: -0.045}},
  ]);
  const part = stageShots([
    {
      a,
      b,
      label: 'finale [path]',
      scene: {members: LAY_B, pen: 1, light: true /* (v42) */, face: (m: Member) => (({mew: 'full_wink', popy: 'full_kiss', halo: 'full_laugh'} as Record<Member, Kind>)[m])},
      rig,
      text: (ctx, T) => {
        logo(ctx, 960, 860, 0.9, T, tH + 1.0);
        // (v15, user: the black came too early and too fast) a slow ease into black over 1.7 s
        const f = easeInOut(prog(T, fadeA, fadeA + 1.7));
        if (f > 0) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = f;
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      },
    },
  ]);
  part.fx[0] = rigBlur(rig, a, b, 0.25, 40); // a visible move, not a smear
  return part;
};

export {flashAt};
export type {Key};
