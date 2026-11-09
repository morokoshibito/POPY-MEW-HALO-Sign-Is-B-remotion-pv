// Ornate lyric rendering on top of drawPlaced: a marker ribbon that grows under each line as the
// glyphs land, light trails behind glyphs in flight, a small star burst where each glyph lands,
// and a gloss sweep across the whole line once it is complete. Pure function of T.
import {Ctx, star4} from './draw';
import {layer} from './blur';
import {hexA} from './fx2d';
import {clamp, easeOutCubic, prog} from './time';
import {Enter, Exit, GUARD, Placed, StyleOf, drawPlaced, due, guardFrame} from './type';

export type Fancy = {
  sparkle?: string[]; // burst colours (none = no bursts)
  ribbon?: {color: string; edge?: string; h?: number; dy?: number}; // marker band under each line
  trail?: boolean; // ghost copies behind glyphs in flight (flow only)
  shine?: boolean; // gloss sweep once the line is complete
  shineAt?: number; // override when the sweep starts
};

/** Lagged ghost copies behind glyphs in flight: off (user rule, v14: no drag after-images, ever). */
const TEXT_TRAILS = false;

const landTime = (p: Placed, enter: Enter) =>
  enter.kind === 'whole'
    ? enter.at + (enter.dur ?? 0.16)
    : enter.kind === 'cascade'
      ? enter.at + p.i * (enter.step ?? 0.035) + (enter.dur ?? 0.22)
      : enter.kind === 'fly'
        ? enter.at + p.i * (enter.step ?? 0.055) + 0.2
        : due(p.t);

export const drawFancy = (ctx: Ctx, ps: Placed[], T: number, style: StyleOf, enter: Enter, f: Fancy, exit?: Exit) => {
  if (!ps.length) return;
  if (!GUARD.active) {
    ctx.save();
    GUARD.active = true;
    guardFrame(ctx, ps);
    try {
      drawFancy(ctx, ps, T, style, enter, f, exit);
    } finally {
      GUARD.active = false;
      ctx.restore();
    }
    return;
  }
  const ex = exit ? clamp((T - exit.at) / (exit.dur ?? 0.18)) : 0;
  if (ex >= 1) return;
  const lines = new Map<number, Placed[]>();
  for (const p of ps) {
    const k = Math.round(p.y / 10);
    const arr = lines.get(k) ?? [];
    arr.push(p);
    lines.set(k, arr);
  }
  // 1. ribbon: grows from the first glyph to the last landed one
  if (f.ribbon) {
    ctx.save();
    ctx.globalAlpha *= 1 - ex;
    for (const ln of lines.values()) {
      const first = ln[0];
      let right = -Infinity;
      for (const p of ln) {
        const k = clamp((T - (landTime(p, enter) - 0.2)) / 0.2);
        if (k > 0) right = Math.max(right, p.x + p.size * 0.5 * easeOutCubic(k) + p.size * 0.15);
      }
      if (right === -Infinity) continue;
      const left = first.x - first.size * 0.62;
      const h = first.size * (f.ribbon.h ?? 0.34);
      const y = first.y + first.size * (f.ribbon.dy ?? 0.3);
      const w = Math.max(0, right - left);
      ctx.save();
      ctx.translate(left, y);
      ctx.rotate(-0.025);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, hexA(f.ribbon.color, 0));
      g.addColorStop(0.06, hexA(f.ribbon.color, 0.9));
      g.addColorStop(0.94, hexA(f.ribbon.color, 0.9));
      g.addColorStop(1, hexA(f.ribbon.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(0, -h / 2, w, h, h / 2);
      ctx.fill();
      if (f.ribbon.edge) {
        ctx.strokeStyle = hexA(f.ribbon.edge, 0.8);
        ctx.lineWidth = Math.max(2, h * 0.08);
        ctx.beginPath();
        ctx.moveTo(h * 0.4, h * 0.55);
        ctx.lineTo(w - h * 0.4, h * 0.55);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  // 2. light trails for glyphs still gliding in
  // (user, v14: no drag after-images of any kind) the lagged ghost copies are switched off for good
  if (TEXT_TRAILS && f.trail && enter.kind === 'flow') {
    const L = enter.lead ?? 0.24;
    for (const lag of [0.05, 0.1, 0.15]) {
      const ghost = ps.filter((p) => {
        const k = (T - (due(p.t) - L)) / L;
        return k > 0.05 && k < 1;
      });
      if (!ghost.length) continue;
      ctx.save();
      ctx.globalAlpha *= 0.3 * (1 - lag / 0.2);
      drawPlaced(ctx, ghost, T - lag, style, enter);
      ctx.restore();
    }
  }
  // 3. the glyphs themselves
  drawPlaced(ctx, ps, T, style, enter, exit);
  // 4. a star burst and a thin ring where each glyph lands
  if (f.sparkle?.length) {
    ctx.save();
    ctx.globalAlpha *= 1 - ex;
    for (const p of ps) {
      const age = T - landTime(p, enter);
      if (age < 0 || age > 0.45) continue;
      const k = age / 0.45;
      const e = easeOutCubic(k);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + p.i * 0.7;
        const d = p.size * (0.45 + 0.55 * e);
        ctx.fillStyle = f.sparkle[(i + p.i) % f.sparkle.length];
        star4(ctx, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, p.size * 0.11 * (1 - k) + 1, 0.22, ang);
        ctx.fill();
      }
      ctx.strokeStyle = hexA(f.sparkle[0], 0.7 * (1 - k));
      ctx.lineWidth = p.size * 0.04 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.5 * e), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 5. gloss sweep across the finished line (drawn through the glyph shapes only)
  if (f.shine) {
    const last = Math.max(...ps.map((p) => landTime(p, enter)));
    const t0 = f.shineAt ?? last + 0.08;
    const k = prog(T, t0, t0 + 0.5);
    if (k > 0 && k < 1 && ex < 1) {
      const {c, g} = layer('fancyShine');
      g.setTransform(ctx.getTransform());
      drawPlaced(g, ps, T, {fill: '#ffffff'}, enter);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of ps) {
        x0 = Math.min(x0, p.x - p.size);
        x1 = Math.max(x1, p.x + p.size);
        y0 = Math.min(y0, p.y - p.size);
        y1 = Math.max(y1, p.y + p.size);
      }
      const bx = x0 + (x1 - x0 + 400) * k - 200;
      const band = g.createLinearGradient(bx - 120, y0, bx + 120, y1);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      band.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = band;
      g.fillRect(x0 - 400, y0 - 400, x1 - x0 + 800, y1 - y0 + 800);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * (1 - ex);
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    }
  }
};
