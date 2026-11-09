import {CROWD_CALLS, PEN_GRIP} from '../tuning';
// Graphic vocabulary of the second reference (りりむ / 葛葉 / 卯月コウ cover): light grey geometric
// tiles, flat colour blocks, trapezoid spotlights, penlight sticks with grey caps, pixel-heart speech
// bubbles, microphones, bubble letters, vertical lyric pills, black capsules. Pure functions of T.
import {COLORS, H, Member, W} from '../config';
import {Ctx, heartPath, star4} from '../lib/draw';
import {hexA} from '../lib/fx2d';
import {clamp, easeOutBack, easeOutCubic, lerp, rnd} from '../lib/time';
import {GStyle, Glyph, Placed} from '../lib/type';
import {fxImage, propImage} from '../lib/assets';
import {drawBlurred, layer} from '../lib/blur';
import {BEAT, beatAt} from '../lib/time';

export const C = (m: Member) => COLORS[m];
export const PINK = '#f766a1';
export const RED = '#ff5a8a';
export const YEL = '#f6ab35';
export const LAV = '#d299eb';
export const INK2 = '#1f1b2b';

// ---------------------------------------------------------------- backgrounds

// ---------------------------------------------------------------- idol-motif tiles (replaces the grey geometry)

/** Reference-1 tones: white, light pink, lavender, sky, cream; vivid pink / purple / gold as accents. */
export const TONE = {
  white: '#fdfbfb',
  pinkL: '#f2dae3',
  pinkM: '#ddb3c0',
  pink: '#f766a1',
  lav: '#d299eb',
  purple: '#7e5de1',
  sky: '#89ccf1',
  cream: '#f2d18d',
  gold: '#f6ab35',
  plum: '#584971',
  ink: '#2e203b',
};
const TILE_COLS = ['#f7dbe6', '#ecdcf7', '#dcecf8', '#f8eacb', '#f5d0e0', '#e5dcf5'];

const star5 = (g: CanvasRenderingContext2D, r: number) => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
};

/** One flat motif centred at 0,0 in a cell of size S. */
const motif = (g: CanvasRenderingContext2D, kind: number, S: number) => {
  const r = S * 0.34;
  g.beginPath();
  switch (kind) {
    case 0: // heart
      heartPath(g, 0, -r * 0.55, r * 1.45);
      g.fill();
      break;
    case 1: // star
      star5(g, r * 1.05);
      g.fill();
      break;
    case 2: {
      // gem (was a microphone: the user asked for no microphones in the background)
      g.moveTo(-r * 0.9, -r * 0.3);
      g.lineTo(-r * 0.45, -r * 0.8);
      g.lineTo(r * 0.45, -r * 0.8);
      g.lineTo(r * 0.9, -r * 0.3);
      g.lineTo(0, r * 0.95);
      g.closePath();
      g.fill();
      break;
    }
    case 3: {
      // music note
      g.ellipse(-r * 0.3, r * 0.6, r * 0.38, r * 0.28, -0.4, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-r * 0.0, -r * 0.95, r * 0.16, r * 1.6);
      g.beginPath();
      g.moveTo(r * 0.16, -r * 0.95);
      g.quadraticCurveTo(r * 0.85, -r * 0.6, r * 0.55, -r * 0.05);
      g.quadraticCurveTo(r * 0.6, -r * 0.45, r * 0.16, -r * 0.5);
      g.fill();
      break;
    }
    case 4: {
      // ribbon bow
      g.moveTo(0, 0);
      g.quadraticCurveTo(-r * 1.1, -r * 0.9, -r * 1.05, 0);
      g.quadraticCurveTo(-r * 1.1, r * 0.9, 0, 0);
      g.quadraticCurveTo(r * 1.1, -r * 0.9, r * 1.05, 0);
      g.quadraticCurveTo(r * 1.1, r * 0.9, 0, 0);
      g.fill();
      g.beginPath();
      g.moveTo(-r * 0.15, r * 0.1);
      g.lineTo(-r * 0.55, r * 1.0);
      g.lineTo(-r * 0.25, r * 0.95);
      g.closePath();
      g.moveTo(r * 0.15, r * 0.1);
      g.lineTo(r * 0.55, r * 1.0);
      g.lineTo(r * 0.25, r * 0.95);
      g.closePath();
      g.fill();
      break;
    }
    case 5: {
      // crown
      g.moveTo(-r, r * 0.6);
      g.lineTo(-r, -r * 0.4);
      g.lineTo(-r * 0.5, r * 0.05);
      g.lineTo(0, -r * 0.75);
      g.lineTo(r * 0.5, r * 0.05);
      g.lineTo(r, -r * 0.4);
      g.lineTo(r, r * 0.6);
      g.closePath();
      g.fill();
      break;
    }
    case 6: // penlight
      g.roundRect(-r * 0.22, -r * 1.05, r * 0.44, r * 2.1, r * 0.22);
      g.fill();
      break;
    case 7: // sparkle
      star4(g, 0, 0, r * 1.05, 0.2, 0);
      g.fill();
      break;
    default: // dotted circle
      for (let i = 0; i < 8; i++) {
        g.beginPath();
        g.arc(Math.cos((i * Math.PI) / 4) * r * 0.8, Math.sin((i * Math.PI) / 4) * r * 0.8, r * 0.17, 0, Math.PI * 2);
        g.fill();
      }
  }
};

const tileCache = new Map<string, HTMLCanvasElement>();
/** A seamless pattern canvas of idol motifs, COLS x ROWS cells of S px. */
const tilePattern = (seed: number, S: number) => {
  const key = `${seed}|${S}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const COLS = 16;
  const ROWS = 10;
  const c = document.createElement('canvas');
  c.width = COLS * S;
  c.height = ROWS * S;
  const g = c.getContext('2d')!;
  g.fillStyle = TONE.white;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < COLS; i++)
    for (let j = 0; j < ROWS; j++) {
      const r = rnd(seed, i * 131 + j * 7);
      if (r < 0.12) continue;
      const kind = Math.floor(rnd(seed + 1, i * 131 + j * 7) * 9);
      g.save();
      g.translate(i * S + S / 2, j * S + S / 2);
      g.rotate((rnd(seed + 2, i * 131 + j * 7) - 0.5) * 0.7);
      const sc = 0.8 + rnd(seed + 3, i * 131 + j * 7) * 0.35;
      g.scale(sc, sc);
      g.fillStyle = TILE_COLS[Math.floor(rnd(seed + 4, i * 131 + j * 7) * TILE_COLS.length)];
      motif(g, kind, S);
      g.restore();
    }
  tileCache.set(key, c);
  return c;
};

/** Idol-motif tiles drifting slowly (hearts, stars, mics, notes, bows, crowns, penlights, sparkles)
 *  in reference-1 pastels. Same signature as before, so every graphic section uses it. */
export const geo = (ctx: Ctx, T: number, o: {seed?: number; size?: number; vx?: number; vy?: number; tint?: string; tintA?: number; shiftY?: number} = {}) => {
  const S = o.size ?? 128;
  const pat = tilePattern((o.seed ?? 1) % 7, S);
  const pw = pat.width;
  const ph = pat.height;
  const ox = (((T * (o.vx ?? 14)) % pw) + pw) % pw;
  const oy = (((T * (o.vy ?? 8) + (o.shiftY ?? 0)) % ph) + ph) % ph; // (v27) shiftY: drawn moved by shiftY, the tiles stay put
  ctx.save();
  for (let x = -pw - ox; x < W * 2; x += pw) for (let y = -ph - oy; y < H * 2; y += ph) if (x + pw > -W && y + ph > -H) ctx.drawImage(pat, x, y);
  if (o.tint) {
    ctx.globalAlpha = o.tintA ?? 0.08;
    ctx.fillStyle = o.tint;
    ctx.fillRect(-W, -H, W * 3, H * 3);
  }
  ctx.restore();
};

/** Spotlight trapezoid from the top (narrow) to the bottom (wide). */
export const beam = (ctx: Ctx, x: number, top: number, wTop: number, wBot: number, color: string, sway = 0, alpha = 1) => {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, top);
  ctx.rotate(sway);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-wTop / 2, 0);
  ctx.lineTo(wTop / 2, 0);
  ctx.lineTo(wBot / 2, H * 1.3);
  ctx.lineTo(-wBot / 2, H * 1.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

/** A vertical lattice truss (scaffold) drawn flat. */
export const truss = (ctx: Ctx, x: number, y0: number, y1: number, w: number, color: string) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y0);
  ctx.lineTo(x - w / 2, y1);
  ctx.moveTo(x + w / 2, y0);
  ctx.lineTo(x + w / 2, y1);
  const step = w;
  let k = 0;
  for (let y = y0; y < y1; y += step, k++) {
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x + w / 2, y + step);
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x + w / 2, y);
  }
  ctx.stroke();
  ctx.restore();
};

/** Flat diagonal stripes across a region (used as frames). */
export const stripes = (ctx: Ctx, color: string, gap: number, width: number, angle: number, offset = 0) => {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  for (let x = -2400 + (offset % gap); x < 2400; x += gap) ctx.fillRect(x, -1600, width, 3200);
  ctx.restore();
};

// ---------------------------------------------------------------- props

/** Penlight: coloured body with a highlight and a grey cap. */
export const penlight = (ctx: Ctx, x: number, y: number, len: number, w: number, rot: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = 'rgba(60,30,60,0.18)';
  ctx.shadowBlur = w * 0.4;
  ctx.shadowOffsetY = w * 0.15;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -len / 2, w, len * 0.78, w / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#d7d7df';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -len / 2 + len * 0.74, w, len * 0.26, [w * 0.2, w * 0.2, w / 2, w / 2]);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.roundRect(-w * 0.28, -len / 2 + w * 0.3, w * 0.18, len * 0.6, w * 0.09);
  ctx.fill();
  ctx.restore();
};

/** Pixel-art heart inside a white speech bubble. */
export const heartBubble = (ctx: Ctx, x: number, y: number, s: number, color: string, alpha = 1) => {
  const P = [
    '.XX.XX.',
    'XXXXXXX',
    'XXXXXXX',
    '.XXXXX.',
    '..XXX..',
    '...X...',
  ];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = 'rgba(40,20,50,0.18)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#3a3542';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(-70, -52, 140, 104);
  ctx.moveTo(-30, 52);
  ctx.lineTo(-44, 80);
  ctx.lineTo(-8, 52);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.stroke();
  const px = 12;
  ctx.fillStyle = color;
  P.forEach((row, r) =>
    Array.from(row).forEach((c, k) => {
      if (c === 'X') ctx.fillRect(-42 + k * px, -38 + r * px, px, px);
    }),
  );
  ctx.restore();
};

/** Microphone: grille ball + tapered handle. `mono` tints everything one colour (the reference's pink mic). */
const micTint = new Map<string, HTMLCanvasElement>();
/** The user's microphone picture (public/props/mic.png, grille up, handle down), tinted for the mono variants. */
const micPicture = (mono?: string) => {
  const black = !mono ? propImage('mic_black') : null;
  const src = black ?? propImage('mic');
  if (!src) return null;
  if (!mono) return src;
  const key = mono;
  let c = micTint.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'color';
    g.fillStyle = mono;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src, 0, 0);
    micTint.set(key, c);
  }
  return c;
};

export const mic = (ctx: Ctx, x: number, y: number, len: number, rot: number, o: {body?: string; grille?: string; mono?: string} = {}) => {
  const pic = micPicture(o.mono);
  if (pic) {
    // the picture's grille top sits at (x, y) like the drawn mic's grille centre; len = full length
    const h = len * 1.17;
    const w = (pic.width / pic.height) * h;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(pic, -w / 2, -len * 0.17, w, h);
    ctx.restore();
    return;
  }
  const body = o.mono ?? o.body ?? '#1e1d24';
  const grille = o.mono ?? o.grille ?? '#8d8d97';
  const r = len * 0.17;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = 'rgba(30,20,40,0.25)';
  ctx.shadowBlur = len * 0.05;
  ctx.shadowOffsetY = len * 0.02;
  // handle
  const g = ctx.createLinearGradient(-r, 0, r, 0);
  g.addColorStop(0, body);
  g.addColorStop(0.4, o.mono ? '#ffffff' : '#4a4955');
  g.addColorStop(1, body);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-r * 0.75, r * 0.9);
  ctx.lineTo(r * 0.75, r * 0.9);
  ctx.lineTo(r * 0.38, len);
  ctx.quadraticCurveTo(0, len + r * 0.25, -r * 0.38, len);
  ctx.closePath();
  ctx.fill();
  // collar
  ctx.fillStyle = o.mono ? hexA('#ffffff', 0.5) : '#3a3944';
  ctx.fillRect(-r * 0.82, r * 0.72, r * 1.64, r * 0.32);
  // grille
  ctx.shadowColor = 'transparent';
  const gb = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  gb.addColorStop(0, o.mono ? '#ffffff' : '#c9c9d2');
  gb.addColorStop(1, grille);
  ctx.fillStyle = gb;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = o.mono ? hexA('#ffffff', 0.45) : 'rgba(40,40,50,0.4)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  for (let k = -r; k <= r; k += r * 0.22) {
    ctx.beginPath();
    ctx.moveTo(-r, k);
    ctx.lineTo(r, k);
    ctx.moveTo(k, -r);
    ctx.lineTo(k, r);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
};

/** Flat colour paper confetti. */
export const paper = (ctx: Ctx, T: number, t0: number, seed: number, n: number, colors: string[], speed = 260) => {
  for (let i = 0; i < n; i++) {
    const lt = T - t0 + rnd(seed, i) * 3;
    const x = rnd(seed + 1, i) * (W + 200) - 100 + Math.sin(lt * 2 + i) * 40;
    const y = ((lt * (speed * (0.7 + rnd(seed + 2, i) * 0.6)) + rnd(seed + 3, i) * H) % (H + 120)) - 60;
    const s = 10 + rnd(seed + 4, i) * 14;
    const spin = lt * (3 + rnd(seed + 5, i) * 5) + i;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin * 0.4);
    ctx.scale(1, Math.abs(Math.cos(spin)) * 0.9 + 0.1);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
    ctx.restore();
  }
};

export const sparkles = (ctx: Ctx, T: number, seed: number, n: number, colors: string[], area = {x: 0, y: 0, w: W, h: H}, size: [number, number] = [14, 36]) => {
  for (let i = 0; i < n; i++) {
    const x = area.x + rnd(seed, i) * area.w;
    const y = area.y + rnd(seed + 1, i) * area.h;
    const tw = 0.5 + 0.5 * Math.sin(T * (2 + rnd(seed + 2, i) * 3) + i * 1.7);
    const s = lerp(size[0], size[1], rnd(seed + 3, i)) * (0.4 + 0.6 * tw);
    ctx.fillStyle = colors[i % colors.length];
    star4(ctx, x, y, s, 0.22, 0);
    ctx.fill();
  }
};

// ---------------------------------------------------------------- lettering

/** Bubble letters: colour fill, thick white outline, soft coloured drop. */
export const BUB = (fillTop: string, fillBot: string, drop: string): GStyle => ({
  fill: [fillTop, fillBot],
  stroke: '#ffffff',
  sw: 0.15,
  extrude: {color: drop, dx: 0.025, dy: 0.06},
});
export const GREY3D: GStyle = {fill: ['#fafafc', '#cfcfd9'], stroke: '#ffffff', sw: 0.06, stroke2: '#8a8a9c', sw2: 0.1, extrude: {color: '#9a9aa8', dx: 0.035, dy: 0.08}};
export const SMALLINK: GStyle = {fill: INK2, weight: 700};

const VROT = 'ー〜～「」『』（）()…―';
const SMALLK = 'ゃゅょっぁぃぅぇぉャュョッァィゥェォ';

/** Vertical layout: columns right to left (or as given), glyphs top to bottom. Columns break on '　'. */
export const layoutVert = (gs: Glyph[], o: {size: number; x: number; y: number; colGap?: number; dir?: 1 | -1; per?: number; stagger?: number}): Placed[] => {
  // break on spaces, then split long runs into balanced columns of at most `per`
  const runsV: Glyph[][] = [[]];
  for (const g of gs) {
    if (g.ch === '\u3000' || g.ch === ' ') {
      if (runsV[runsV.length - 1].length) runsV.push([]);
      continue;
    }
    runsV[runsV.length - 1].push(g);
  }
  const cols: Glyph[][] = [];
  for (const r of runsV.filter((x) => x.length)) {
    if (!o.per || r.length <= o.per) {
      cols.push(r);
      continue;
    }
    const n = Math.ceil(r.length / o.per);
    const per = Math.ceil(r.length / n);
    for (let i = 0; i < r.length; i += per) cols.push(r.slice(i, i + per));
  }
  const out: Placed[] = [];
  const gap = o.colGap ?? o.size * 1.25;
  const dir = o.dir ?? -1;
  cols.forEach((col, ci) => {
    const x = o.x + dir * ci * gap;
    let y = o.y + ci * (o.stagger ?? 0);
    for (const g of col) {
      const small = SMALLK.includes(g.ch);
      const sz = o.size * (small ? 0.72 : 1);
      out.push({ch: g.ch, t: g.t, x: x + (small ? o.size * 0.12 : 0), y: y - (small ? o.size * 0.08 : 0), size: sz, rot: VROT.includes(g.ch) ? Math.PI / 2 : 0, i: out.length});
      y += o.size * (small ? 0.78 : 1.02);
    }
  });
  return out;
};

/** Neon heart outline (glowing stroke). */
export const neonHeart = (ctx: Ctx, x: number, y: number, s: number, color: string, rot = 0) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  heartPath(ctx, 0, -s * 0.4, s);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = hexA(color, 0.35);
  ctx.lineWidth = s * 0.16;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.08;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = s * 0.025;
  ctx.stroke();
  ctx.restore();
};


// ---------------------------------------------------------------- audience penlights (anchored below the frame, layered)

export type CrowdOpts = {/** (v43) beat-locked sway: one cycle every `beats` beats, -cos phase (left extreme on the bar line), each stick off by up to ±spread rad */ sync?: {spread: number}; /** (v43) size of every stick and holder */ scale?: number; /** (v43) the near row this much lower (px) */ nearDrop?: number; lift?: (id: number, phase: number) => number; liftRef?: number; straighten?: number; colors?: string[]; far?: number; mid?: number; near?: number; amp?: number; rise?: number; seed?: number; spread?: number; nearBlur?: number; y?: number; beats?: number; people?: boolean; wide?: number};

export const CROWD_INK = '#3b2850';
/** A person holding a penlight, seen from behind (silhouette): bent arm up to the fist at (x, y), the back of the
 *  head beside it, shoulders, the body going on down. u = the stick's width. */
/** (v52) (x, y) = the bottom end of the handle (as before v51). The forearm leaves the fist straight down the
 *  stick's own axis (the wrist in line with the handle, as a hand holding something up is), then bends away. */
export const holder = (g: CanvasRenderingContext2D, x: number, y: number, u: number, sd: number, a: number) => {
  g.save();
  g.fillStyle = CROWD_INK;
  g.strokeStyle = CROWD_INK;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const dn = {x: -Math.sin(a), y: Math.cos(a)};
  const fc = fistCentre(x, y, u, a);
  const wl = PEN_GRIP.wrist * u;
  const fx = fc.x, fy = fc.y;
  const wx = fc.x + dn.x * wl, wy = fc.y + dn.y * wl;
  g.lineWidth = u * 1.0;
  g.beginPath();
  g.moveTo(fx, fy);
  g.lineTo(wx, wy);
  g.lineTo(x + sd * u * 1.7, y + u * 3.6);
  g.lineTo(x + sd * u * 0.7, y + u * 6.2);
  g.stroke();
  const hx = x - sd * u * 1.75;
  g.beginPath();
  g.ellipse(hx, y + u * 5.6, u * 2.2, u * 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(hx + sd * u * 0.4, y + u * 10.2, u * 4.8, u * 3.6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(hx - u * 4.4, y + u * 10.2, u * 9.4, u * 40);
  g.restore();
};

/** (v52) where the fist sits: its top edge PEN_GRIP.sink stick-widths up the handle from the bottom end, so the
 *  handle goes INTO the hand (its end hidden in the fist) instead of the fist being stuck on below it. */
export const fistCentre = (x: number, y: number, w: number, a: number) => {
  const d = (PEN_GRIP.height / 2 - PEN_GRIP.sink) * w;
  return {x: x - Math.sin(a) * d, y: y + Math.cos(a) * d};
};
/** (v52) The fist as one plain silhouette, the same ink as the arm (no drawn fingers): a rounded block a little wider
 *  than the stick, round the lower handle, lined up with it; the tube's colour faintly on its top edge.
 *  (x, y) = the bottom end of the handle. */
export const gripFist = (g: CanvasRenderingContext2D, x: number, y: number, w: number, a: number, col: string) => {
  const P = PEN_GRIP;
  const c = fistCentre(x, y, w, a);
  const fw = w * P.width, fh = w * P.height;
  g.save();
  g.translate(c.x, c.y);
  g.rotate(a);
  g.beginPath();
  g.roundRect(-fw / 2, -fh / 2, fw, fh, [fw * 0.42, fw * 0.42, fw * 0.3, fw * 0.3]);
  g.fillStyle = CROWD_INK;
  g.fill();
  if (P.lit > 0) {
    g.clip();
    const lg = g.createLinearGradient(0, -fh / 2, 0, -fh / 2 + fh * 0.35);
    lg.addColorStop(0, hexA(col, P.lit));
    lg.addColorStop(1, hexA(col, 0));
    g.fillStyle = lg;
    g.fillRect(-fw, -fh, fw * 2, fh * 2);
  }
  g.restore();
};

/** Penlights held by an audience below the frame: every stick pivots at a point under the bottom edge,
 *  rows far (small, many) -> near (huge, few, soft); all wave together on the beat with small offsets. */
/** (v48) -cos with the time spent shaped: swayShape 1 = plain pendulum; bigger = longer at the ends, faster through the middle. */
export const swayCurve = (th: number) => {
  const c = -Math.cos(th);
  return Math.sign(c) * Math.pow(Math.abs(c), 1 / Math.max(1, CROWD_CALLS.swayShape));
};

export const penCrowd = (ctx: Ctx, T: number, o: CrowdOpts = {}) => {
  const seed = o.seed ?? 1;
  const cols = o.colors ?? [PINK, YEL, RED, LAV, '#ffffff'];
  const rise = o.rise ?? 1;
  const amp = Math.min(o.amp ?? 0.2, 0.8); // (user: swing wider)
  const baseY = o.y ?? H;
  // a slow, even wave (one side per bar: a full cycle every eight beats), like an audience outside the chorus
  const wave = (i: number, ph: number) => Math.sin((2 * Math.PI * T) / ((o.beats ?? 8) * BEAT) + ph + rnd(seed + 9, i) * 0.5);
  // (v43, user: 0:14 and 2:38 one left-right cycle per bar) locked to the beat grid: left at the bar line, right
  // two beats later; each stick's own phase also drives its hops (lift)
  const phase = (i: number) => (o.sync ? (rnd(seed + 9, i) - 0.5) * 2 * o.sync.spread : 0);
  const sway = (i: number, ph: number) => (o.sync ? swayCurve((2 * Math.PI * (beatAt(T) + CROWD_CALLS.beatLead)) / (o.beats ?? 4) + phase(i)) : wave(i, ph));
  const sc = o.scale ?? 1;
  // (v17, user: pulled back, the penlights floated with no one under them) `people`: each stick is held - fist,
  // bent arm, the back of the head and shoulders (silhouettes, below the frame in the usual framing); `wide`:
  // extra screen widths of crowd on each side (for cameras that travel far)
  const wide = o.wide ?? 0;
  const row = (g: CanvasRenderingContext2D, n0: number, len: [number, number], wd: [number, number], depth: number, rs: number, drop = 0) => {
    const x0 = -100 - wide * W;
    const span = W + 200 + 2 * wide * W;
    const n = Math.round(n0 * (span / (W + 200)));
    for (let k = 0; k < n; k++) {
      // the old sticks keep their draws (the usual framing is unchanged); the extra ones get new indices
      const kk = k - Math.round(n0 * wide * W / (W + 200));
      const i = kk >= 0 && kk < n0 ? kk : 500 + k;
      const u = (k + 0.5) / n;
      const px = x0 + u * span + (rnd(rs, i) - 0.5) * (W / n0) * 0.8;
      const L = lerp(len[0], len[1], rnd(rs + 1, i)) * sc;
      const w = lerp(wd[0], wd[1], rnd(rs + 2, i)) * sc;
      const up = easeOutCubic(clamp(rise * 1.3 - rnd(rs + 3, i) * 0.3));
      // (v37) lift: this stick's own arm raised (px, up), held straighter the higher it goes
      const lf = o.lift ? o.lift(rs * 1000 + i, phase(i)) : 0;
      const py = baseY + depth + drop + (1 - up) * (L + 200) - lf;
      // lean outward from the centre, wave together
      const lean = (px - W / 2) / W * 0.5 + (rnd(rs + 4, i) - 0.5) * 0.35;
      // (v45, user: a full pendulum swing all the time) only the resting lean straightens when raised; the swing keeps its whole amplitude
      const a = lean * (o.lift ? 1 - (o.straighten ?? 0) * clamp(lf / (o.liftRef ?? 1)) : 1) + amp * sway(i, depth * 0.002);
      const cx = px + Math.sin(a) * L * 0.5;
      const cy = py - Math.cos(a) * L * 0.5;
      const col = cols[Math.floor(rnd(rs + 5, i) * cols.length)];
      if (o.people) holder(g, px, py, w, rnd(rs + 6, i) < 0.5 ? -1 : 1, a);
      penlight(g, cx, cy, L, w, a, col);
      // (v52) the fist round the lower handle, over it
      if (o.people) gripFist(g, px, py, w, a, col);
    }
  };
  row(ctx, o.far ?? 20, [170, 250], [34, 44], 30, seed * 7 + 1);
  row(ctx, o.mid ?? 10, [330, 450], [64, 84], 110, seed * 7 + 2);
  const nn = o.near ?? 4;
  if (nn > 0) {
    const {c, g} = layer('penNear');
    g.setTransform(ctx.getTransform());
    row(g, nn, [720, 980], [150, 205], 330, seed * 7 + 3, o.nearDrop ?? 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBlurred(ctx, c, o.nearBlur ?? 7);
    ctx.restore();
  }
};

// ---------------------------------------------------------------- love bubbles flying up (layered)

/** White speech bubbles with pixel hearts rising; `depth`: far (small, sharp), mid, near (big, soft). */
export const loveBubbles = (ctx: Ctx, T: number, t0: number, depth: 'far' | 'mid' | 'near', o: {n?: number; seed?: number; speed?: number; area?: {x: number; w: number}; colors?: string[]; scale?: number} = {}) => {
  const P = {far: {s: 0.75, n: 16, v: 120, blur: 0}, mid: {s: 1.35, n: 9, v: 190, blur: 0}, near: {s: 2.5, n: 5, v: 300, blur: 9}}[depth];
  const n = o.n ?? P.n;
  const seed = (o.seed ?? 3) * 13 + (depth === 'far' ? 0 : depth === 'mid' ? 1 : 2);
  const cols = o.colors ?? [RED, PINK, YEL, '#ff8fb1', LAV];
  const area = o.area ?? {x: -100, w: W + 200};
  const span = H + 420;
  const draw = (g: CanvasRenderingContext2D) => {
    for (let i = 0; i < n; i++) {
      const lt = T - t0;
      const sp = (o.speed ?? P.v) * (0.75 + rnd(seed, i) * 0.5);
      const y = H + 210 - ((((lt * sp + rnd(seed + 1, i) * span) % span) + span) % span);
      const x = area.x + rnd(seed + 2, i) * area.w + Math.sin(lt * 1.3 + i * 2.1) * 24;
      const pop = easeOutBack(clamp((lt - rnd(seed + 3, i) * 0.35) / 0.25), 2.2);
      if (pop <= 0) continue;
      heartBubble(g, x, y, P.s * (o.scale ?? 1) * (0.8 + rnd(seed + 4, i) * 0.4) * pop, cols[i % cols.length]);
    }
  };
  if (P.blur > 0) {
    const {c, g} = layer('bubNear');
    g.setTransform(ctx.getTransform());
    draw(g);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBlurred(ctx, c, P.blur, 0.92);
    ctx.restore();
  } else draw(ctx);
};

// ---------------------------------------------------------------- stars rising over the portraits

export const risingStars = (ctx: Ctx, T: number, seed: number, o: {n?: number; colors?: string[]; area?: {x: number; y: number; w: number; h: number}; speed?: number} = {}) => {
  const cols = o.colors ?? ['#ffffff', YEL, '#ffe27a', PINK];
  const area = o.area ?? {x: 0, y: 0, w: W, h: H};
  const n = o.n ?? 26;
  for (let i = 0; i < n; i++) {
    const sp = (o.speed ?? 170) * (0.6 + rnd(seed, i) * 0.8);
    const span = area.h + 200;
    const y = area.y + area.h + 100 - ((((T * sp + rnd(seed + 1, i) * span) % span) + span) % span);
    const x = area.x + rnd(seed + 2, i) * area.w + Math.sin(T * 1.7 + i) * 18;
    const s = 12 + rnd(seed + 3, i) * 34;
    const tw = 0.65 + 0.35 * Math.sin(T * 5 + i * 1.3);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(T * (rnd(seed + 4, i) - 0.5) * 2);
    ctx.globalAlpha *= tw;
    ctx.fillStyle = cols[i % cols.length];
    if (i % 3 === 0) {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? s * 0.42 : s;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      star4(ctx, 0, 0, s, 0.2, 0);
      ctx.fill();
    }
    ctx.restore();
  }
};

// ---------------------------------------------------------------- chunky shapes rising fast, in three depths

/** Stars, hearts and rings shooting up past the camera (reference 2's fast, staggered rise; no text boxes).
 *  far: small and sharp; mid; near: big and out of focus. */
export const riseShapes = (ctx: Ctx, T: number, t0: number, depth: 'far' | 'mid' | 'near', o: {n?: number; seed?: number; speed?: number; colors?: string[]} = {}) => {
  const P = {far: {s: [18, 34], n: 22, v: 420, blur: 0}, mid: {s: [44, 70], n: 12, v: 680, blur: 0}, near: {s: [110, 170], n: 6, v: 1000, blur: 10}}[depth];
  const n = o.n ?? P.n;
  const seed = (o.seed ?? 5) * 17 + (depth === 'far' ? 0 : depth === 'mid' ? 1 : 2);
  const cols = o.colors ?? [RED, PINK, YEL, '#ff9a3d', LAV, '#ffffff'];
  const span = H + 500;
  const draw = (g: CanvasRenderingContext2D) => {
    for (let i = 0; i < n; i++) {
      const lt = T - t0;
      const sp = (o.speed ?? 1) * P.v * (0.75 + rnd(seed, i) * 0.5);
      const y = H + 250 - ((((lt * sp + rnd(seed + 1, i) * span) % span) + span) % span);
      // the near (big, soft) ones keep to the sides: they give depth but never cover the faces in the middle
      const u = rnd(seed + 2, i);
      const x = depth === 'near' ? (u < 0.5 ? -120 + u * 1000 : 1540 + (u - 0.5) * 1000) : -100 + u * (W + 200);
      const pop = easeOutBack(clamp((lt - rnd(seed + 3, i) * 0.25) / 0.2), 2.2);
      if (pop <= 0) continue;
      const s = lerp(P.s[0], P.s[1], rnd(seed + 4, i)) * pop;
      const col = cols[i % cols.length];
      g.save();
      g.translate(x, y);
      g.rotate(lt * (rnd(seed + 5, i) - 0.5) * 3);
      g.lineJoin = 'round';
      if (i % 3 === 0) {
        star5(g, s);
        g.fillStyle = col;
        g.fill();
        g.lineWidth = s * 0.14;
        g.strokeStyle = '#ffffff';
        g.stroke();
      } else if (i % 3 === 1) {
        g.beginPath();
        g.moveTo(0, s * 0.35);
        g.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
        g.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
        g.closePath();
        g.fillStyle = col;
        g.fill();
        g.lineWidth = s * 0.14;
        g.strokeStyle = '#ffffff';
        g.stroke();
      } else {
        g.beginPath();
        g.arc(0, 0, s * 0.7, 0, Math.PI * 2);
        g.lineWidth = s * 0.22;
        g.strokeStyle = col;
        g.stroke();
      }
      g.restore();
    }
  };
  if (P.blur > 0) {
    const {c, g} = layer('riseNear');
    g.setTransform(ctx.getTransform());
    draw(g);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBlurred(ctx, c, P.blur, 0.9);
    ctx.restore();
  } else draw(ctx);
};

// ---------------------------------------------------------------- lens flare (three.js flare textures, MIT)

const tintCache = new Map<string, HTMLCanvasElement>();
const tinted = (im: HTMLImageElement, col: string) => {
  const key = `${im.src}|${col}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const g = c.getContext('2d')!;
  g.drawImage(im, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = col;
  g.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  return c;
};

/** Photographic lens flare for a light at (x, y) in screen space: the bright core with its streaks, a thin
 *  anamorphic streak, and ghosts (coloured hexagons / rings) on the line through the frame centre, as a real
 *  lens makes them. Additive. Uses the three.js lens-flare textures (public/fx); nothing if they are missing. */
export const lensFlare = (ctx: Ctx, x: number, y: number, k: number, tint = '#ffd9b0') => {
  const core = fxImage('lensflare0');
  const ring = fxImage('lensflare2');
  const ghost = fxImage('lensflare3');
  if (!core || k <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const s = 900 * k;
  ctx.globalAlpha = Math.min(1, k);
  ctx.drawImage(tinted(core, tint), x - s / 2, y - s / 2, s, s);
  // anamorphic streak
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(5, 0.05);
  ctx.globalAlpha = 0.55 * Math.min(1, k);
  ctx.drawImage(tinted(core, '#ffc6e6'), -s / 2, -s / 2, s, s);
  ctx.restore();
  // ghosts along the axis through the centre
  const ax = W / 2 - x;
  const ay = H / 2 - y;
  const G: [number, number, string, 'g' | 'r'][] = [
    [0.55, 70, '#ffd27a', 'g'],
    [0.8, 140, '#ff9ad0', 'g'],
    [1.05, 50, '#bfe6ff', 'g'],
    [1.35, 220, '#ffb0e0', 'r'],
    [1.7, 110, '#c9b0ff', 'g'],
  ];
  G.forEach(([t, size, col, kind]) => {
    const im = kind === 'r' ? ring : ghost;
    if (!im) return;
    const gs = size * k * (kind === 'r' ? 2.2 : 1);
    ctx.globalAlpha = (kind === 'r' ? 0.35 : 0.5) * Math.min(1, k);
    ctx.drawImage(tinted(im, col), x + ax * t - gs / 2, y + ay * t - gs / 2, gs, gs);
  });
  ctx.restore();
};
