import {STRONG} from '../config';
import {Ctx, star4} from '../lib/draw';
import {Fx} from '../lib/post';
import {clamp, lerp} from '../lib/time';
import {INK} from './styles';

// Each template returns shots (drawn between a and b; higher z on top) and fx (full-frame).

/** cam: the shot's camera (scene -> screen), declared so the self-check can measure the motion without drawing. */
export type Shot = {a: number; b: number; z?: number; label: string; draw: (ctx: Ctx, T: number) => void; cam?: (T: number) => {x: number; y: number; z: number; r: number}; turn?: boolean};
// turn: the motion changes direction on purpose at this cut (hidden by a wipe); the self-check allows it
export type FxFn = (T: number, fx: Fx) => void;
export type Part = {shots: Shot[]; fx: FxFn[]};

export const env = (T: number, at: number, att: number, rel: number) => {
  if (T < at - att || T > at + rel) return 0;
  if (T < at) return att <= 0 ? 1 : (T - (at - att)) / att;
  return rel <= 0 ? 0 : 1 - (T - at) / rel;
};

// ---------------------------------------------------------------- fx helpers

export const flashAt = (at: number, rel = 0.3, amt = 1): FxFn => (T, fx) => {
  fx.flash = Math.max(fx.flash, env(T, at, 0.02, rel) * amt * STRONG.flash);
};
/** Colour grade for a span (crossfades 0.2 s at both ends). */
export const grade = (a: number, b: number, g: Partial<Fx>): FxFn => (T, fx) => {
  if (T < a - 0.2 || T > b + 0.2) return;
  const k = Math.min(clamp((T - a + 0.2) / 0.4), clamp((b + 0.2 - T) / 0.4));
  const mix = (x: number, y: number) => lerp(x, y, k);
  if (g.bloom !== undefined) fx.bloom = mix(fx.bloom, g.bloom);
  if (g.threshold !== undefined) fx.threshold = mix(fx.threshold, g.threshold);
  if (g.exposure !== undefined) fx.exposure = mix(fx.exposure, g.exposure);
  if (g.contrast !== undefined) fx.contrast = mix(fx.contrast, g.contrast);
  if (g.saturation !== undefined) fx.saturation = mix(fx.saturation, g.saturation);
  if (g.vignette !== undefined) fx.vignette = mix(fx.vignette, g.vignette);
  if (g.letterbox !== undefined) fx.letterbox = T >= a && T < b ? g.letterbox : fx.letterbox;
  if (g.tint) fx.tint = [mix(fx.tint[0], g.tint[0]), mix(fx.tint[1], g.tint[1]), mix(fx.tint[2], g.tint[2])];
  if (g.lift) fx.lift = [mix(fx.lift[0], g.lift[0]), mix(fx.lift[1], g.lift[1]), mix(fx.lift[2], g.lift[2])];
};

export {star4, INK};
