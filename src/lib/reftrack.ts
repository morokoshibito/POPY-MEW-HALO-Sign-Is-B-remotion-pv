// Camera motion learnt from the second reference, frame by frame. ref2_track.json holds, for every frame
// of the reference (24 fps; composition time = frame / 24 + 2.5), the similarity transform between it and
// the previous frame (screen translation of the centre in px at 1920 wide, log-scale, rotation), measured
// with feature matching (tools/track.py; per-shot validation in docs/ref2_track_shots.tsv).
// A rig built from it moves our camera exactly as the reference camera moved at the same moment:
// the same accelerating cut-outs, decelerating cut-ins, slow drift in between, rotations and zooms.
import data from '../data/ref2_track.json';
import {Cam, Rig} from './rig';
import {clamp} from './time';

type Sim = {s: number; th: number; dx: number; dy: number};
const FR = (data as {frames: number[][]}).frames;
const FPS_R = 24;
const T0 = 2.5;

// cumulative transforms C_k: frame 0 -> frame k (centre coordinates)
const CUM: Sim[] = [];
{
  let s = 1;
  let th = 0;
  let dx = 0;
  let dy = 0;
  for (let k = 0; k < FR.length; k++) {
    const [fx, fy, ls, rot] = FR[k];
    const si = Math.exp(ls);
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const nx = si * (c * dx - sn * dy) + fx;
    const ny = si * (sn * dx + c * dy) + fy;
    dx = nx;
    dy = ny;
    s *= si;
    th += rot;
    CUM.push({s, th, dx, dy});
  }
}

const cumAt = (T: number): Sim => {
  const f = clamp((T - T0) * FPS_R, 0, FR.length - 1);
  const k = Math.floor(f);
  const u = f - k;
  const a = CUM[k];
  const b = CUM[Math.min(FR.length - 1, k + 1)];
  return {s: a.s * Math.pow(b.s / a.s, u), th: a.th + (b.th - a.th) * u, dx: a.dx + (b.dx - a.dx) * u, dy: a.dy + (b.dy - a.dy) * u};
};

/** Relative screen transform from time ta to T (both composition time): screen_T = s R(th) screen_ta + d. */
export const refRel = (ta: number, T: number): Sim => {
  const A = cumAt(ta);
  const B = cumAt(T);
  const s = B.s / A.s;
  const th = B.th - A.th;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  return {s, th, dx: B.dx - s * (c * A.dx - sn * A.dy), dy: B.dy - s * (sn * A.dx + c * A.dy)};
};

export type Gain = {xy?: number; z?: number; r?: number};

/** Camera at T given the framing `cam` at time `ta`, moved by the reference camera (with optional gains). */
export const fromRef = (cam: Cam, ta: number, T: number, g: Gain = {}): Cam => {
  const rel = refRel(ta, T);
  const s = Math.pow(rel.s, g.z ?? 1);
  const th = rel.th * (g.r ?? 1);
  const dx = rel.dx * (g.xy ?? 1);
  const dy = rel.dy * (g.xy ?? 1);
  const z = cam.z * s;
  const r = cam.r + th;
  // screen = z R(r)(p - c) + centre  ->  c' = c - R(-r') d / z'
  const c = Math.cos(-r);
  const sn = Math.sin(-r);
  return {x: cam.x - (c * dx - sn * dy) / z, y: cam.y - (sn * dx + c * dy) / z, z, r};
};

/** A rig that follows the reference camera, framed as `cam` at time `ta` (default: shot start + 40 %). */
export const refRig = (a: number, b: number, cam: Cam, o: {ta?: number; gain?: Gain} = {}): Rig => {
  const ta = o.ta ?? a + (b - a) * 0.4;
  return (T) => fromRef(cam, ta, clamp(T, a, b - 1e-4), o.gain);
};
