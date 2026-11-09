import {H, W} from '../config';
import {DEADLINE} from '../lib/type';
import {noFx} from '../lib/post';
import {easeInOut, lerp, prog} from '../lib/time';
import {Part, Shot} from './templates';
import {penlight, RED} from './popkit';
import {CROWD_CALLS, PEN_SWING} from '../tuning';
import {beatT} from '../lib/time';
import {drawBlurred, gpuBlur, layer} from '../lib/blur';

/** The reveal boundary and the physical prop share one screen-space transform. */
export const penlightWipePose = (T: number, cut: number) => ({
  x: lerp(2650, -730, easeInOut(prog(T, cut - 0.28, cut + 0.18))),
  y: H / 2,
  r: 0.5,
});

/** Join two complete scenes behind a right-to-left penlight, including their overlays. */
export const joinPenlightWipe = (before: Part, after: Part, cut: number): Part => {
  const a = cut - 0.28, b = cut + 0.18;
  let incoming: HTMLCanvasElement | undefined;
  const drawPart = (ctx: CanvasRenderingContext2D, part: Part, selectionT: number, T: number) => {
    const shots = part.shots.filter(s => selectionT >= s.a && selectionT < s.b)
      .map((s, i) => ({s, i})).sort((x, y) => (x.s.z ?? 0) - (y.s.z ?? 0) || x.i - y.i);
    for (const {s} of shots) {
      ctx.save();
      const previous = DEADLINE.t;
      DEADLINE.t = s.b;
      s.draw(ctx, T);
      DEADLINE.t = previous;
      ctx.restore();
    }
  };
  const wipe: Shot = {a, b, label: 'penlight reveal [turn]', turn: true, draw: (ctx, T) => {
    // The outgoing camera keeps moving; selection holds its last shot across the original cut.
    drawPart(ctx, before, Math.min(T, cut - 1e-6), T);
    incoming ??= Object.assign(document.createElement('canvas'), {width: W, height: H});
    const g = incoming.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    // Render in isolation so the stage's blur/post layers cannot sample the outgoing image.
    drawPart(g, after, Math.max(T, cut), T);
    const p = penlightWipePose(T, cut);
    const edge = (y: number) => p.x - Math.tan(p.r) * (y - p.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(edge(0), 0);
    ctx.lineTo(W + 4000, 0);
    ctx.lineTo(W + 4000, H);
    ctx.lineTo(edge(H), H);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(incoming, 0, 0);
    ctx.restore();
    // Long enough to cover the seam at both screen edges, even with the diagonal tilt.
    penlight(ctx, p.x, p.y, 1900, 420, p.r, RED);
  }};
  return {
    shots: [
      ...before.shots.filter(s => s.a < a).map(s => ({...s, b: Math.min(s.b, a)})),
      wipe,
      ...after.shots.filter(s => s.b > b).map(s => ({...s, a: Math.max(s.a, b)})),
    ],
    fx: [(T, fx) => {
      if (T < a || T >= b) {
        for (const f of [...before.fx, ...after.fx]) f(T, fx);
        return;
      }
      // Avoid a full-frame grading step at the old cut while both scenes are visible.
      const oldFx = noFx(), newFx = noFx();
      for (const f of before.fx) f(Math.min(T, cut - 1e-6), oldFx);
      for (const f of after.fx) f(Math.max(T, cut), newFx);
      const u = easeInOut(prog(T, a, b));
      for (const key of Object.keys(oldFx) as (keyof typeof oldFx)[]) {
        if (key === 'frame') continue;
        if (key === 'tint' || key === 'lift') {
          fx[key] = oldFx[key].map((v, i) => lerp(v, newFx[key][i], u)) as [number, number, number];
        } else fx[key] = lerp(oldFx[key], newFx[key], u);
      }
    }],
  };
};

/** Draw every shot of `part` live at T (selection at selectionT), z-sorted, like the main renderer. */
const drawPartAt = (ctx: CanvasRenderingContext2D, part: Part, selectionT: number, T: number) => {
  const shots = part.shots.filter(s => selectionT >= s.a && selectionT < s.b)
    .map((s, i) => ({s, i})).sort((x, y) => (x.s.z ?? 0) - (y.s.z ?? 0) || x.i - y.i);
  for (const {s} of shots) {
    ctx.save();
    const previous = DEADLINE.t;
    DEADLINE.t = s.b;
    s.draw(ctx, T);
    DEADLINE.t = previous;
    ctx.restore();
  }
};

/** (v46, user, 0:18) one thick red penlight right in front of the lens (out of focus), waved left to right from
 *  the audience below the frame: it pivots on the hand under the bottom edge. What it has not reached yet (right)
 *  is still the outgoing scene; what it has swept (left) is already the next one; the seam runs under the tube.
 *  The swing is a hand's: easing in and out. Parameters: tuning.ts PEN_SWING. */
/** (v48) the swing's window on the beat grid: from a left extreme of the crowd's swing to the next right one. */
export const penSwingWindow = () => {
  const a = beatT(PEN_SWING.startBeat - CROWD_CALLS.beatLead);
  return {a, b: a + PEN_SWING.durBeats * (beatT(1) - beatT(0))};
};
export const joinPenlightSwing = (before: Part, after: Part, cut: number): Part => {
  const S = PEN_SWING;
  const {a, b} = penSwingWindow();
  let incoming: HTMLCanvasElement | undefined;
  const pivot = {x: S.pivotX, y: H + S.pivotY};
  const angleAt = (T: number) => lerp(-S.angle, S.angle, (1 - Math.cos(Math.PI * prog(T, a, b))) / 2); // a pendulum half-swing, like the crowd's
  const wipe: Shot = {a, b, label: 'penlight swing [turn]', turn: true, draw: (ctx, T) => {
    drawPartAt(ctx, before, Math.min(T, b - 1e-6), T);
    incoming ??= Object.assign(document.createElement('canvas'), {width: W, height: H});
    const g = incoming.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    drawPartAt(g, after, Math.max(T, a), T);
    const th = angleAt(T);
    const d = {x: Math.sin(th), y: -Math.cos(th)}; // hand -> tip
    const n = {x: d.y, y: -d.x}; // toward the swept (left) side
    const B = 6000;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.moveTo(pivot.x - d.x * B, pivot.y - d.y * B);
    ctx.lineTo(pivot.x + d.x * B, pivot.y + d.y * B);
    ctx.lineTo(pivot.x + d.x * B + n.x * B, pivot.y + d.y * B + n.y * B);
    ctx.lineTo(pivot.x - d.x * B + n.x * B, pivot.y - d.y * B + n.y * B);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(incoming, 0, 0);
    ctx.restore();
    // the tube: coloured edges, a white-hot core, rounded tip; drawn out of focus, then its own light round it
    const {c: lc, g: lg} = layer('penSwing');
    lg.save();
    lg.translate(pivot.x, pivot.y);
    lg.rotate(th);
    const w = S.width;
    const gr = lg.createLinearGradient(-w / 2, 0, w / 2, 0);
    gr.addColorStop(0, S.color);
    gr.addColorStop(0.3, S.color);
    gr.addColorStop(0.5, '#fff4f4');
    gr.addColorStop(0.7, S.color);
    gr.addColorStop(1, S.color);
    lg.fillStyle = gr;
    lg.beginPath();
    lg.roundRect(-w / 2, -S.len, w, S.len, w / 2);
    lg.fill();
    lg.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (S.blur > 0) drawBlurred(ctx, lc, S.blur);
    else ctx.drawImage(lc, 0, 0);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = S.bloom;
    ctx.drawImage(gpuBlur(lc, 60), 0, 0);
    ctx.globalAlpha = S.bloom * 0.6;
    ctx.drawImage(gpuBlur(lc, 180), 0, 0);
    ctx.restore();
  }};
  return {
    shots: [
      ...before.shots.filter(s => s.a < a).map(s => ({...s, b: Math.min(s.b, a)})),
      wipe,
      ...after.shots.filter(s => s.b > b).map(s => ({...s, a: Math.max(s.a, b)})),
    ],
    fx: [(T, fx) => {
      if (T < a || T >= b) {
        for (const f of [...before.fx, ...after.fx]) f(T, fx);
        return;
      }
      const oldFx = noFx(), newFx = noFx();
      for (const f of before.fx) f(Math.min(T, cut - 1e-6), oldFx);
      for (const f of after.fx) f(Math.max(T, cut), newFx);
      const u = easeInOut(prog(T, a, b));
      for (const key of Object.keys(oldFx) as (keyof typeof oldFx)[]) {
        if (key === 'frame') continue;
        if (key === 'tint' || key === 'lift') {
          fx[key] = oldFx[key].map((v, i) => lerp(v, newFx[key][i], u)) as [number, number, number];
        } else fx[key] = lerp(oldFx[key], newFx[key], u);
      }
    }],
  };
};
