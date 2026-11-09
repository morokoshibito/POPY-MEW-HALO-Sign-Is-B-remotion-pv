import lyrics from '../data/lyrics.json';
import {PRE} from '../config';

// ---------------------------------------------------------------- beat grid
// SVP project: constant tempo from position 0; the instrumental starts
// meta.instrumental_offset_in_project_s into the project.
const BPM: number = (lyrics.meta.tempo as {position: number; bpm: number}[])[0].bpm;
export const BEAT = 60 / BPM;
export const EIGHTH = BEAT / 2;
const INST_IN_PROJECT: number = lyrics.meta.instrumental_offset_in_project_s;

/** Composition time of project beat k (k counted from 0 at the SVP project start). */
export const beatT = (k: number) => PRE - INST_IN_PROJECT + k * BEAT;
/** Project beat (fractional) at composition time T. */
export const beatAt = (T: number) => (T - PRE + INST_IN_PROJECT) / BEAT;

// ---------------------------------------------------------------- maths
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInCubic = (x: number) => Math.pow(clamp(x), 3);
export const easeInOut = (x: number) => {
  const k = clamp(x);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};
export const easeOutBack = (x: number, s = 1.70158) => {
  const k = clamp(x) - 1;
  return 1 + (s + 1) * k * k * k + s * k * k;
};

// ---------------------------------------------------------------- deterministic random
export const hash = (n: number) => {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};
export const rnd = (a: number, b = 0) => hash(a * 12.9898 + b * 78.233);
