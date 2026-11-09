// Camera rigs: the camera is a pure function of T. A Cam is the scene point at the frame centre,
// a zoom and a roll. Rigs are built from keyframes (with easing) or from measured velocity profiles,
// and the motion blur of the post pass is derived from the camera speed, so a fast pan or zoom blurs
// by itself (as in the reference).
import {FPS, H, W} from '../config';
import {Fx} from './post';
import {clamp} from './time';

export type Cam = {x: number; y: number; z: number; r: number};
export type Rig = (T: number) => Cam;
export type Ease = 'lin' | 'in' | 'out' | 'io' | 'out2' | 'in2' | 'hold';

export type Key = {t: number; x?: number; y?: number; z?: number; r?: number; e?: Ease};

/** Apply a camera to a context (scene -> screen). `par` < 1 = farther layer (moves and zooms less). */
export const view = (ctx: CanvasRenderingContext2D, c: Cam, par = 1) => {
  const z = 1 + (c.z - 1) * par;
  const x = W / 2 + (c.x - W / 2) * par;
  const y = H / 2 + (c.y - H / 2) * par;
  ctx.translate(W / 2, H / 2);
  if (c.r) ctx.rotate(c.r * par);
  ctx.scale(z, z);
  ctx.translate(-x, -y);
};

/** Motion blur from the rig speed during [a, b). shutter = fraction of the frame interval. */
/** (Disabled, user: no motion smear of any kind, ever.) It used to add a directional / zoom / spin blur from the
 *  camera speed; now it does nothing, so every frame is sharp and the motion is only the real camera move. */
export const rigBlur = (rig: Rig, a: number, b: number, shutter = 0.8, maxPx = 220): ((T: number, fx: Fx) => void) => (T, fx) => {
  if (MOTION_BLUR_OFF || T < a || T >= b) return;
  const dt = 1 / (FPS * 2);
  const t0 = Math.max(a, T - dt);
  const t1 = Math.min(b - 1e-4, T + dt);
  if (t1 <= t0) return;
  const c0 = rig(t0);
  const c1 = rig(t1);
  const k = (1 / FPS / (t1 - t0)) * shutter; // per-frame displacement times shutter
  const vx = -(c1.x - c0.x) * c1.z * k;
  const vy = -(c1.y - c0.y) * c1.z * k;
  const clampPx = (v: number) => Math.max(-maxPx, Math.min(maxPx, v));
  fx.dirX += clampPx(vx);
  fx.dirY += clampPx(vy);
  fx.zoom = Math.max(fx.zoom, Math.min(0.35, Math.abs(Math.log(c1.z / c0.z)) * k));
  fx.spin += (c1.r - c0.r) * k;
};

const MOTION_BLUR_OFF = true;

// ---------------------------------------------------------------- the reference's camera rule

export type Move = {dx?: number; dy?: number; z?: number; r?: number; dur?: number};
export type Drift = {x?: number; y?: number; z?: number; r?: number}; // per second (z: log-zoom per second)

/** Shot camera after the reference: arrives fast from an offset (`enter`) and decelerates, drifts slowly
 *  through the middle, and leaves fast toward `exit` (accelerating). dx/dy are screen px (converted to
 *  scene px by the zoom), z multiplies the zoom, r adds roll (radians). */
export const swing = (a: number, b: number, rest: Cam, o: {enter?: Move; exit?: Move; drift?: Drift} = {}): Rig => (T) => {
  const t = T - a;
  const d = o.drift ?? {};
  let x = rest.x + (d.x ?? 0) * t;
  let y = rest.y + (d.y ?? 0) * t;
  let z = rest.z * Math.exp((d.z ?? 0) * t);
  let r = rest.r + (d.r ?? 0) * t;
  if (o.enter) {
    const dur = o.enter.dur ?? 0.32;
    const k = 1 - Math.pow(1 - clamp(t / dur), 3); // 0 -> 1, fast then slow
    const off = 1 - k;
    x -= ((o.enter.dx ?? 0) * off) / z;
    y -= ((o.enter.dy ?? 0) * off) / z;
    z *= Math.pow(o.enter.z ?? 1, off);
    r += (o.enter.r ?? 0) * off;
  }
  if (o.exit) {
    const dur = o.exit.dur ?? 0.22;
    const k = Math.pow(clamp((T - (b - dur)) / dur), 3); // 0 -> 1, slow then fast
    x -= ((o.exit.dx ?? 0) * k) / z;
    y -= ((o.exit.dy ?? 0) * k) / z;
    z *= Math.pow(o.exit.z ?? 1, k);
    r += (o.exit.r ?? 0) * k;
  }
  return {x, y, z, r};
};

/** Apply a rig to a context for the duration of fn (scene -> screen). */
export const inCam = (ctx: CanvasRenderingContext2D, c: Cam, fn: () => void, par = 1) => {
  ctx.save();
  view(ctx, c, par);
  fn();
  ctx.restore();
};


// ---------------------------------------------------------------- live camera (U-shaped speed), for shots without a usable reference track

export type LiveMove = {dx?: number; dy?: number; z?: number; r?: number};
/** Shot camera after the reference's habits: arrives moving fast and decelerates (exponential, tau ~0.2 s,
 *  visible over ~0.7 s; `spring` adds one elastic overshoot), keeps drifting through the middle, and
 *  accelerates out over the last `outDur` seconds. Offsets are screen px / zoom factor / radians. */
export const live = (a: number, b: number, base: Cam, o: {enter?: LiveMove; exit?: LiveMove; drift?: Drift; tauIn?: number; tauOut?: number; outDur?: number; spring?: boolean} = {}): Rig => {
  const tin = o.tauIn ?? 0.2;
  const tout = o.tauOut ?? 0.13;
  const D = Math.min(o.outDur ?? 0.5, (b - a) * 0.45);
  return (T) => {
    const t = Math.max(0, T - a);
    const d = o.drift ?? {};
    let x = base.x;
    let y = base.y;
    let z = base.z * Math.exp((d.z ?? 0) * t);
    let r = base.r + (d.r ?? 0) * t;
    let sx = (d.x ?? 0) * t;
    let sy = (d.y ?? 0) * t;
    let lz = 0;
    if (o.enter) {
      const off = o.spring ? Math.exp(-t / (tin * 1.6)) * Math.cos(t * 9) : Math.exp(-t / tin);
      sx += (o.enter.dx ?? 0) * off;
      sy += (o.enter.dy ?? 0) * off;
      lz += Math.log(o.enter.z ?? 1) * off;
      r += (o.enter.r ?? 0) * off;
    }
    if (o.exit) {
      const u = T - (b - D);
      if (u > 0) {
        const g = (Math.exp(u / tout) - 1) / (Math.exp(D / tout) - 1);
        sx += (o.exit.dx ?? 0) * g;
        sy += (o.exit.dy ?? 0) * g;
        lz += Math.log(o.exit.z ?? 1) * g;
        r += (o.exit.r ?? 0) * g;
      }
    }
    z *= Math.exp(lz);
    // screen offsets: content moves by (sx, sy) on screen
    const c = Math.cos(-r);
    const sn = Math.sin(-r);
    x -= (c * sx - sn * sy) / z;
    y -= (sn * sx + c * sy) / z;
    return {x, y, z, r};
  };
};


// ---------------------------------------------------------------- glide: the camera rule of reference 2

/** Speed profile of a shot camera after reference 2 (measured on 80 shots): it arrives fast (median 740 px/s)
 *  and decelerates exponentially, keeps moving slowly through the middle (~95 px/s, never still), and
 *  accelerates exponentially out of the shot (~400 px/s at the cut). The speed is one smooth U that never
 *  touches zero, and every channel keeps one direction for the whole shot:
 *    speed(t) = mid * (1 + (inK - 1) e^(-t / tauIn) + (outK - 1) e^((t - D) / tauOut))
 *  dir: direction the picture travels on screen; px: middle speed (screen px/s); rot: middle roll speed
 *  (rad/s, signed; by default it follows the travel: picture moving right -> turning clockwise); zoom: middle
 *  log-zoom speed (+ = pushing in). `at`: the moment the camera equals `base` (default: the middle).
 *  outK = 1 for a shot that does not cut out moving (the motion continues into a held or matched next shot). */
export type Glide = {dir?: [number, number]; px?: number; rot?: number; zoom?: number; inK?: number; outK?: number; tauIn?: number; tauOut?: number; at?: number};
export const glideOffset = (a: number, b: number, o: Glide) => {
  const D = Math.max(0.05, b - a);
  const inK = o.inK ?? 9;
  const outK = o.outK ?? 6;
  const ti = o.tauIn ?? 0.16;
  const to = o.tauOut ?? 0.12;
  const F = (t: number) => t + (inK - 1) * ti * (1 - Math.exp(-t / ti)) + (outK - 1) * to * (Math.exp((t - D) / to) - Math.exp(-D / to));
  const tm = (o.at ?? (a + b) / 2) - a;
  return (T: number) => F(clamp(T - a, 0, D)) - F(tm);
};
export const glide = (a: number, b: number, base: Cam, o: Glide = {}): Rig => {
  const off = glideOffset(a, b, o);
  const [ux0, uy0] = o.dir ?? [1, 0];
  const n = Math.hypot(ux0, uy0) || 1;
  const ux = ux0 / n;
  const uy = uy0 / n;
  const px = o.px ?? 90;
  const rot = o.rot ?? Math.sign(ux || 1) * 0.02;
  const zoom = o.zoom ?? 0;
  return (T) => {
    const s = off(T);
    const z = base.z * Math.exp(zoom * s);
    const r = base.r + rot * s;
    const sx = ux * px * s;
    const sy = uy * px * s;
    const c = Math.cos(-r);
    const sn = Math.sin(-r);
    return {x: base.x - (c * sx - sn * sy) / z, y: base.y - (sn * sx + c * sy) / z, z, r};
  };
};

/** One continuous camera through framings (a camera path, not a pan): Catmull-Rom through the key cameras
 *  (x, y, log zoom, roll) with time as the parameter. The velocity is continuous and stays non-zero at the
 *  keys (no stop at each framing); `endHold` keeps a slow drift after the last key instead of stopping. */
export const flow = (ks: {t: number; cam: Cam}[], o: {drift?: Drift} = {}): Rig => {
  const P = ks.map((k) => [k.cam.x, k.cam.y, Math.log(k.cam.z), k.cam.r]);
  const n = ks.length;
  const tan = (i: number) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dt = ks[b].t - ks[a].t || 1;
    return P[i].map((_, j) => (P[b][j] - P[a][j]) / dt);
  };
  const M = ks.map((_, i) => tan(i));
  return (T) => {
    let v: number[];
    if (T <= ks[0].t) v = P[0];
    else if (T >= ks[n - 1].t) {
      const d = o.drift ?? {};
      const u = T - ks[n - 1].t;
      v = [P[n - 1][0] + (M[n - 1][0] + (d.x ?? 0)) * u * 0.5, P[n - 1][1] + (M[n - 1][1] + (d.y ?? 0)) * u * 0.5, P[n - 1][2] + (d.z ?? 0) * u, P[n - 1][3] + (d.r ?? 0) * u];
    } else {
      let i = 0;
      while (i < n - 2 && T > ks[i + 1].t) i++;
      const h = ks[i + 1].t - ks[i].t;
      const s = (T - ks[i].t) / h;
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
      const h10 = s ** 3 - 2 * s ** 2 + s;
      const h01 = -2 * s ** 3 + 3 * s ** 2;
      const h11 = s ** 3 - s ** 2;
      v = P[i].map((p, j) => h00 * p + h10 * h * M[i][j] + h01 * P[i + 1][j] + h11 * h * M[i + 1][j]);
    }
    return {x: v[0], y: v[1], z: Math.exp(v[2]), r: v[3]};
  };
};

/** Several shot-cameras in one continuous shot (no jump): segment i adds its own glide motion (travel px along
 *  dir, roll, zoom) on top of where the previous segment ended. Per segment options (e.g. the roll turning the
 *  other way when a singer comes in from the other side). */
export const glideSeq = (times: number[], base: Cam, segs: Glide[]): Rig => {
  const S = times.slice(0, -1).map((t, i) => ({a: t, b: times[i + 1], o: segs[i], off: glideOffset(t, times[i + 1], {...segs[i], at: t})}));
  return (T) => {
    let sx = 0;
    let sy = 0;
    let r = base.r;
    let lz = 0;
    for (const g of S) {
      if (T <= g.a) break;
      const s = g.off(Math.min(T, g.b));
      const [ux0, uy0] = g.o.dir ?? [0, 0];
      const nn = Math.hypot(ux0, uy0) || 1;
      sx += (ux0 / nn) * (g.o.px ?? 0) * s;
      sy += (uy0 / nn) * (g.o.px ?? 0) * s;
      r += (g.o.rot ?? 0) * s;
      lz += (g.o.zoom ?? 0) * s;
    }
    const z = base.z * Math.exp(lz);
    const c = Math.cos(-r);
    const sn = Math.sin(-r);
    return {x: base.x - (c * sx - sn * sy) / z, y: base.y - (sn * sx + c * sy) / z, z, r};
  };
};

/** Keyframes (missing fields carried over) played as a continuous spline path (flow): the same framings as
 *  keys(), but the camera never stops at a key. */
export const keysFlow = (ks: Key[]): Rig => {
  let cur: Cam = {x: 960, y: 540, z: 1, r: 0};
  return flow(
    ks.map((k) => {
      cur = {x: k.x ?? cur.x, y: k.y ?? cur.y, z: k.z ?? cur.z, r: k.r ?? cur.r};
      return {t: k.t, cam: {...cur}};
    }),
  );
};

/** An accelerating move into the cut (v15, user: never hide the move behind a white flash). Over the last
 *  `dur` seconds before `b` the camera pushes (zoom > 1) or pulls (zoom < 1) by the factor `zoom`, turns by
 *  `rot` and travels by (dx, dy) or toward the framing `to`, all on one exponential ramp (tau: how late the
 *  speed builds; the speed is highest at the cut). A white flash may sit on the last frames, but the move is
 *  seen before it. */
export const intoCut = (rig: Rig, b: number, o: {dur?: number; tau?: number; zoom?: number; rot?: number; dx?: number; dy?: number; to?: {x: number; y: number}}): Rig => {
  const D = o.dur ?? 0.45;
  const tau = o.tau ?? 0.13;
  const den = Math.exp(D / tau) - 1;
  return (T) => {
    const c = rig(T);
    const u = T - (b - D);
    if (u <= 0) return c;
    const g = (Math.exp(Math.min(u, D) / tau) - 1) / den;
    const lz = Math.log(o.zoom ?? 1) * g;
    const x = o.to ? c.x + (o.to.x - c.x) * g : c.x + (o.dx ?? 0) * g;
    const y = o.to ? c.y + (o.to.y - c.y) * g : c.y + (o.dy ?? 0) * g;
    return {x, y, z: c.z * Math.exp(lz), r: c.r + (o.rot ?? 0) * g};
  };
};
