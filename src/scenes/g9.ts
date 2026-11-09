import {penSwingWindow} from './penlightWipe';
import {PRE_KEYWORD, CREDITS_OUT, CHU_BG, CHU_CAMERA, CHU_PORTRAIT, CHU_SIGN, CHU_FLASH, CROWD_CALLS, LETTER_SPACING, LIGHTSHOW_OUT, TOUR_PULL} from '../tuning';
// Graphic sections, version 9: rebuilt after a second, closer study of reference 2 and the user's notes.
// Camera rule everywhere: cut in fast and decelerate, drift slowly in the middle, leave fast (often
// rotating). Figures are placed by their face (same head size across members); nothing resizes per frame.
// Lyrics appear whole; only the intro / reprise / outro syllables are sung-timed (agreed exception).
import {FONT, H, Member, NAMES, W} from '../config';
import {Kind, hasImage} from '../lib/assets';
import {drawBlurred, layer} from '../lib/blur';
import {Ctx, faceShot, figAt, heartPath, label, ring, star4, sunburst} from '../lib/draw';
import {drawFancy} from '../lib/fancy';
import {glow, hexA} from '../lib/fx2d';
import {Seg} from '../lib/lyrics';
import {Cam, Rig, glide, glideSeq, inCam, intoCut, keysFlow, live, rigBlur, swing, view} from '../lib/rig';
import {refRig} from '../lib/reftrack';
import {BEAT, beatAt, clamp, easeInCubic, easeInOut, easeOutBack, easeOutCubic, lerp, prog, rnd} from '../lib/time';
import {GStyle, Glyph, Placed, drawGlyph, drawPlaced, glyphs, layoutLine} from '../lib/type';
import {BUB, C, GREY3D, LAV, PINK, RED, YEL, beam, geo, layoutVert, mic, neonHeart, paper, penCrowd, swayCurve, holder, gripFist, penlight, riseShapes, lensFlare, risingStars, sparkles, stripes, truss} from './popkit';
import {IntroTimes} from './ref2';
import {Part, Shot, flashAt} from './templates';

const ORDER: Member[] = ['mew', 'popy', 'halo'];
const lead = 0.12;
const noSpace = (gs: Glyph[]) => gs.filter((g) => g.ch !== '　' && g.ch !== ' ');
const whoOf = (sg: Seg): Member[] => (sg.who.length ? ORDER.filter((m) => sg.who.includes(m)) : ORDER);
/** Letter colour per member (reference-1 tones). */
const MC: Record<Member, [string, string]> = {popy: ['#ff6f8e', '#d4234f'], mew: ['#b48cff', '#7a4fe0'], halo: ['#ffc24a', '#e08a00']};
const BIGTXT = (m: Member): GStyle => BUB(MC[m][0], MC[m][1], hexA(MC[m][1], 0.5));
const cascade = (at: number, step = 0.035) => ({kind: 'cascade' as const, at, step, dur: 0.22, drop: 0.3});
// チュッ: the dedicated blown-kiss picture when it exists (public/chars/<m>_chu.png), else the kiss / wink one
const kissOf = (m: Member): Kind => (hasImage(m, 'chu') ? 'chu' : hasImage(m, 'kiss') ? 'kiss' : 'wink');

/** A graphic shot seen through a rig (scene drawn in scene coordinates), plus screen-space overlay. */
const camShot = (a: number, b: number, label: string, rig: Rig, scene: (ctx: Ctx, T: number) => void, over?: (ctx: Ctx, T: number) => void): Shot => ({
  a,
  b,
  label,
  cam: rig,
  draw: (ctx, T) => {
    inCam(ctx, rig(T), () => scene(ctx, T));
    over?.(ctx, T);
  },
});
const blurOf = (shots: {a: number; b: number; rig: Rig}[]) => shots.map((s) => rigBlur(s.rig, s.a, s.b));

/** Light tile background in reference-1 tones (scene coordinates, covers any camera). */
const bg = (ctx: Ctx, T: number, seed: number, tint?: string, tintA = 0.1, vx = 18, vy = 10) => geo(ctx, T, {seed, tint, tintA, vx, vy});

const white = (ctx: Ctx, a: number, col = '#ffffff') => {
  if (a <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, a);
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

/** Damped spring 0 -> 1 with overshoot (pop-up), and the squash that goes with it. */
const spring = (t: number) => (t <= 0 ? 0 : 1 - Math.exp(-7 * t) * Math.cos(15 * t));
const squash = (t: number) => (t <= 0 ? 1 : 1 + 0.14 * Math.exp(-5.5 * t) * Math.sin(15 * t));

// ---------------------------------------------------------------- title animation

const TCOL: [string, string][] = [
  [RED, '#c41f4e'],
  ['#ff8fb8', '#e0337a'],
  [YEL, '#d98a00'],
  [LAV, '#8a5ae0'],
  ['#ff6f8e', '#c41f4e'],
];
/** Title: grey letters drop in one by one (squash on landing, ring + sparkles), a star flies across on an
 *  arc leaving glitter and colours each letter as it passes (pop), a swoosh underlines, a heart pops, then
 *  the letters keep bobbing. */
export const titleFancy = (ctx: Ctx, cx: number, cy: number, sc: number, T: number, t0: number, o: {heart?: boolean} = {}) => {
  const chars = Array.from('サインはB');
  const lw = 220;
  const xs = chars.map((_, i) => -((chars.length - 1) * lw) / 2 + i * lw);
  const star = (u: number) => ({x: lerp(-760, 760, u), y: -170 - Math.sin(u * Math.PI) * 140});
  const ts = t0 + 0.55; // star start (grey only briefly)
  const td = 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.rotate(-0.05);
  // swoosh underline drawn after the colouring
  const sw = easeOutCubic(prog(T, ts + td - 0.1, ts + td + 0.35));
  if (sw > 0) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = hexA(PINK, 0.9);
    ctx.lineWidth = 26;
    ctx.beginPath();
    for (let i = 0; i <= 40 * sw; i++) {
      const u = i / 40;
      const x = lerp(-560, 600, u);
      const y = 150 + Math.sin(u * Math.PI * 1.3) * 26 - u * 20;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();
  }
  chars.forEach((ch, i) => {
    const tin = t0 + i * 0.09;
    const k = clamp((T - tin) / 0.24);
    if (k <= 0) return;
    const land = clamp((T - tin - 0.24) / 0.5);
    const fall = 1 - easeInCubic(k);
    const sq = k < 1 ? 1 : 1 + 0.16 * Math.exp(-land * 6) * Math.sin(land * 18);
    const bob = Math.sin((T - t0) * 3.2 + i * 1.1) * 8 * clamp((T - ts - td) / 0.5);
    const x = xs[i];
    const y = -fall * 520 + Math.sin(i * 1.9) * 16 + bob;
    const rot = Math.sin(i * 2.3) * 0.08 + fall * (i % 2 ? 0.4 : -0.4);
    // landing ring and sparkles
    const rk = clamp((T - tin - 0.24) / 0.35);
    if (rk > 0 && rk < 1) {
      ring(ctx, x, y + 40, 60 + 180 * easeOutCubic(rk), 10 * (1 - rk), hexA('#ffffff', 1 - rk));
      for (let j = 0; j < 5; j++) {
        const ang = -Math.PI / 2 + (j - 2) * 0.55;
        ctx.fillStyle = [YEL, '#ffffff', PINK][j % 3];
        star4(ctx, x + Math.cos(ang) * 150 * easeOutCubic(rk), y + 30 + Math.sin(ang) * 150 * easeOutCubic(rk), 18 * (1 - rk) + 2, 0.2, 0);
        ctx.fill();
      }
    }
    // colour: when the star passes this letter
    const ux = (x + 760) / 1520;
    const pc = clamp((T - (ts + ux * td)) / 0.12);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / Math.sqrt(sq), sq);
    const pop = 1 + 0.22 * Math.sin(Math.PI * pc);
    if (pc < 1) drawGlyph(ctx, ch, GREY3D, 230, 0, 0, rot, 1, clamp(k * 3));
    if (pc > 0) drawGlyph(ctx, ch, BUB(TCOL[i][0], TCOL[i][0], hexA('#5a1630', 0.45)), 230, 0, 0, rot, pop, pc);
    ctx.restore();
  });
  // the star and its glitter trail
  const su = clamp((T - ts) / td);
  if (T > ts && su < 1.2) {
    for (let j = 0; j < 14; j++) {
      const u = su - j * 0.035;
      if (u < 0 || u > 1) continue;
      const p = star(u);
      ctx.save();
      ctx.globalAlpha = 1 - j / 14;
      ctx.fillStyle = j % 2 ? '#ffffff' : '#ffe27a';
      star4(ctx, p.x + Math.sin(j * 2.7) * 18, p.y + Math.cos(j * 1.9) * 18, 22 - j, 0.25, j);
      ctx.fill();
      ctx.restore();
    }
    if (su <= 1) {
      const p = star(su);
      ctx.save();
      ctx.shadowColor = '#ffd84a';
      ctx.shadowBlur = 40;
      ctx.fillStyle = YEL;
      star4(ctx, p.x, p.y, 70, 0.22, su * 6);
      ctx.fill();
      ctx.restore();
    }
  }
  // heart pops at the end of the word
  const kh = o.heart === false ? 0 : easeOutBack(clamp((T - (ts + td + 0.05)) / 0.25), 2.6); // (v26) the cover leaves it out
  if (kh > 0) {
    ctx.save();
    ctx.translate(xs[xs.length - 1] + 190, -150 + Math.sin((T - t0) * 3) * 10);
    ctx.scale(kh, kh);
    ctx.rotate(0.2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, Math.PI * 2);
    ctx.fill();
    neonHeart(ctx, 0, 0, 90, PINK, 0);
    ctx.restore();
  }
  ctx.restore();
};

/** Stars and hearts drifting up with a soft glow (decoration over a shot). */
export const floatGlow = (ctx: Ctx, T: number, seed: number, t0: number, n = 18) => {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const sp = 70 + rnd(seed, i) * 90;
    const span = H + 300;
    const lt = T - t0 + rnd(seed + 1, i) * 6;
    const y = H + 150 - ((lt * sp) % span);
    const x = rnd(seed + 2, i) * W + Math.sin(lt * 1.2 + i) * 40;
    const s = 16 + rnd(seed + 3, i) * 26;
    const col = [YEL, PINK, '#ffffff', LAV, '#ffb3c8'][i % 5];
    ctx.save();
    ctx.globalAlpha = 0.85 * clamp((T - t0) / 0.4);
    ctx.translate(x, y);
    ctx.rotate(Math.sin(lt * 1.5 + i) * 0.4);
    ctx.shadowColor = col;
    ctx.shadowBlur = 26;
    ctx.fillStyle = col;
    if (i % 3 === 0) {
      heartPath(ctx, 0, -s * 0.4, s * 1.3);
      ctx.fill();
    } else {
      star4(ctx, 0, 0, s, 0.22, 0);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
};

// ---------------------------------------------------------------- intro / reprise / outro

/** Four-point stars bursting over a cut (overlay, screen space). (v15, user) the big centre star in the
 *  member's colour; the others all different in size, colour, timing and spin (never a row of twins). */
const starBurst = (at: number, centre: string, pre = 0.2, post = 0.16, more = false): Shot => ({
  a: at - pre,
  b: at + post,
  z: 10,
  label: 'star burst',
  draw: (ctx, T) => {
    const k = prog(T, at - pre, at + post);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // [x, y, size, colour, delay (share of the burst), spin speed]
    const pts: [number, number, number, string, number, number][] = [
      [400, 290, 680, YEL, 0.0, 1.9],
      [1540, 770, 430, '#5fd6e0', 0.07, 1.3],
      [1490, 230, 300, '#ffffff', 0.13, 2.4],
      [430, 830, 360, PINK, 0.04, 1.6],
      [1190, 980, 190, '#ff9a3d', 0.17, 2.8],
      [760, 120, 150, LAV, 0.1, 2.2],
      [960, 540, 1500, centre, 0.02, 1.4],
    ];
    // (v35, user: at 1:29 the stars did not cover the frame, the upper right least) more and bigger stars, the
    // corners first of all (the camera leaves to the upper right)
    if (more)
      pts.push(
        [1700, 160, 1050, YEL, 0.03, 1.7],
        [1880, 620, 760, PINK, 0.06, 2.0],
        [1300, 60, 620, LAV, 0.09, 2.3],
        [180, 120, 640, '#5fd6e0', 0.08, 1.5],
        [160, 980, 700, YEL, 0.05, 1.8],
        [1820, 1000, 640, '#5fd6e0', 0.1, 2.1],
        [960, 540, 2300, centre, 0.0, 1.2],
      );
    pts.forEach(([x, y, size, col, d, spin], i) => {
      const g = Math.sin(Math.PI * clamp((k - d) * 1.2));
      if (g <= 0) return;
      ctx.fillStyle = col;
      star4(ctx, x, y, size * easeInOut(g), 0.2, -k * spin + i); // counter-clockwise, as the camera
      ctx.fill();
    });
    ctx.restore();
  },
});

/** サインは shot (intro, reprise, outro): the turn of the picture (and the mic with it) has stopped at this
 *  fraction of the shot; smaller = in place sooner. v23 0.85, v26 0.62; (v28, user: no spring, a little slower
 *  than v26 but faster than v23) 0.72. The turn: r = 1.9 (1 - u / SIGN_TURN_END)^2.5, then still. */
const SIGN_TURN_END = 0.72;

/** v31: the letter and flower are one rigid badge: shared pop, growth, rotation and reveal mask. */
const B_FLY = {POP: 0.1, HOLD: 0.5, TAIL: 0.3, END: 7};
const FLOWER = {R: 300, PETALS: 10, DISC: 0.68, SPIN: 0.8, FLY_SPIN: 1.2, OPEN_AT: 0.06, COVER: 1300, HOLE: 0.3, RIM: 18};

export const tIntro9 = (s0: number, end: number, t: IntroTimes, idolM: Member): Part => {
  const chuM = idolM; // the チュッ of this repetition and the member who pops up on アイドル are the same (user's order)
  const cuts = {
    // measured cuts relative to the sung syllables: ナ -0.12, タ -0.09, の -0.19, アイドル +0.08
    na: t.na - 0.12,
    ta: t.ta - 0.09,
    no: t.no - 0.19,
    // (v16, user: the アイドル pop came late, all three times) the cut 0.04 s before the sung ア (was 0.08 after)
    ai: t.ai - 0.04,
    // (v16, user: サインは at once, and earlier, with its transition and the things behind it) 0.24 s before サ
    sa: t.sa - 0.24,
    flower: t.b - 0.14,
    trio: t.b + 0.22,
    chu: t.chu - CHU_CAMERA.leadSeconds,
    // no title glimpse when there is no room for it (reprise / outro: the チュッ runs to the end; user: looked like a bug)
    title: end - (t.chu + 0.42) > 0.8 ? t.chu + 0.42 : end,
  };
  // (v35) the CHU card flies away from this beat (it stays whole until then, over the start of the next shot);
  // the title (first time) starts its own entrance when the card is out of the way
  // (v36, user: earlier; tuning.ts CHU_SIGN.cardAt / total) never before the cut: the shrinking card shows the next shot
  const flyAt = Math.max(cuts.title, t.chu + CHU_SIGN.cardAt);
  const titleT = flyAt + CHU_SIGN.total * 0.35;
  const shots: Shot[] = [];
  const rigs: {a: number; b: number; rig: Rig}[] = [];
  const add = (a: number, b: number, label: string, rig: Rig, scene: (ctx: Ctx, T: number) => void, over?: (ctx: Ctx, T: number) => void) => {
    if (b - a < 0.01) return;
    shots.push(camShot(a, b, label, rig, scene, over));
    rigs.push({a, b, rig});
  };
  const R: Cam = {x: W / 2, y: H / 2, z: 1, r: 0};

  // ア / ナ / タ: one more member each time, tinted in the letter colour; each cut in from its own angle
  type Bg = {m: Member; x: number; y: number; f: number};
  const syl = (ch: string, a: number, b: number, col: [string, string], members: Bg[], seed: number) =>
    add(
      a,
      b,
      `intro ${ch}`,
      // the reference camera of this very moment (arrives moving, keeps drifting)
      refRig(a, b, R, {ta: a + (b - a) * 0.75}),
      (ctx, T) => {
        bg(ctx, T, seed, col[0], 0.35);
        members.forEach((p) => figAt(ctx, p.m, p.m === 'mew' ? 'full' : 'main', p.x, p.y, p.f, 'duotone', col[0], col[1], {shadow: 0.25}));
        sparkles(ctx, T, seed + 3, 9, ['#ffffff', YEL], {x: 0, y: 0, w: W, h: H}, [16, 36]);
        // (v15, user) no grey disc rolling in at the end of タ
      },
      (ctx, T) => {
        const k = (T - a) / 0.16;
        if (k > 0) drawGlyph(ctx, ch, BUB(col[0], col[1], hexA(col[1], 0.5)), 720, 1180, 560, -0.08, lerp(1.45, 1, easeOutCubic(clamp(k))), clamp(k * 4));
      },
    );
  // ア: the member of this repetition; ナ: a second one on top; タ: all three (newest on top)
  const rest = ORDER.filter((m) => m !== idolM);
  const SC: [string, string][] = [MC[idolM], MC[rest[0]], MC[rest[1]]];
  syl('ア', s0, cuts.na, SC[0], [{m: idolM, x: 900, y: 330, f: 640}], 11);
  syl('ナ', cuts.na, cuts.ta, SC[1], [{m: idolM, x: 160, y: 380, f: 540}, {m: rest[0], x: 1060, y: 330, f: 620}], 12);
  syl('タ', cuts.ta, cuts.no, SC[2], [{m: idolM, x: -160, y: 400, f: 500}, {m: rest[0], x: 420, y: 360, f: 540}, {m: rest[1], x: 1160, y: 320, f: 620}], 13);

  // の: pulls back with a slight turn (measured 0.74x, +12 deg), darker grey so it reads on the light ground
  const NO: GStyle = {fill: ['#f4f4f8', '#b4b4c4'], stroke: '#ffffff', sw: 0.06, stroke2: '#7c7c8e', sw2: 0.105, extrude: {color: '#8c8c9e', dx: 0.035, dy: 0.08}};
  add(
    cuts.no,
    cuts.ai,
    'intro の',
    swing(cuts.no, cuts.ai, R, {enter: {z: 1.35, r: -0.2, dur: 0.3}, drift: {z: -0.08, r: 0.04}}),
    (ctx, T) => {
      ctx.fillStyle = '#ffe6ef';
      ctx.fillRect(-W, -H, W * 3, H * 3);
      bg(ctx, T, 14, PINK, 0.12);
      for (let i = 0; i < 18; i++) {
        const x = rnd(140, i) * W;
        const y = rnd(141, i) * H - (T - cuts.no) * 70 * (0.5 + rnd(142, i));
        const s = 26 + rnd(143, i) * 44;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4 + (T - cuts.no));
        ctx.fillStyle = hexA(PINK, 0.85);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
    },
    (ctx, T) => drawGlyph(ctx, 'の', NO, 660, 960, 540, lerp(-0.4, 0.04, easeOutCubic(clamp((T - cuts.no) / 0.25))), 1, clamp((T - cuts.no) / 0.06)),
  );

  // アイドル: a different member pops up each time (spring, squashes twice), circles open, ドル / アイ drop in;
  // leaves with a fast spin into a star burst
  const popT = cuts.ai;
  add(
    cuts.ai,
    cuts.sa,
    `intro アイドル ${idolM}`,
    // the reference motion for position and zoom; the roll is one counter-clockwise turn that accelerates all
    // the way to the cut (user: never stop, never turn back clockwise), into a counter-clockwise star burst
    ((ref: Rig): Rig => (T) => {
      const c = ref(T);
      const D = cuts.sa - cuts.ai;
      // (v15, user: spin faster) 1.9 rad on the last stretch, tau 0.15 (was 1.1 rad, 0.13)
      return {...c, z: c.z * Math.exp(0.06 * (T - cuts.ai)) * (1 - 0.12 * Math.exp(-(T - cuts.ai) / 0.15)), r: -(0.03 * (T - cuts.ai) + 1.9 * (Math.exp((T - cuts.sa) / 0.15) - Math.exp(-D / 0.15)))};
    })(refRig(cuts.ai, cuts.sa, R, {ta: cuts.ai + 0.1, gain: {xy: 0, z: 0, r: 0}})),
    (ctx, T) => {
      bg(ctx, T, 15, C(idolM).main, 0.06);
      const lt = T - cuts.ai;
      const open = easeOutCubic(clamp((lt - 0.04) / 0.26));
      // (v15, user) the circles in the colour of the member who pops up
      (
        [
          [700, C(idolM).light],
          [560, hexA(C(idolM).main, 0.55)],
          [450, hexA(C(idolM).main, 0.85)],
        ] as [number, string][]
      ).forEach(([r, c]) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(960, 560, r * open, 0, Math.PI * 2);
        ctx.fill();
      });
      ring(ctx, 960, 560, 610 * open, 12, '#ffffff');
      // pop-up from below the frame, scaled about the feet
      const pt = T - popT;
      if (pt > 0) {
        const y = lerp(900, 0, spring(pt));
        const sy = squash(pt - 0.12);
        ctx.save();
        ctx.translate(960, 1250 + y);
        ctx.scale(1 / Math.sqrt(sy), sy);
        ctx.translate(-960, -1250);
        figAt(ctx, idolM, idolM === 'mew' ? 'full' : 'laugh', 960, 330, 330);
        ctx.restore();
      }
      sparkles(ctx, T, 151, 12, ['#ffffff', YEL], {x: 300, y: 100, w: 1320, h: 800}, [12, 30]);
    },
    (ctx, T) => {
      // (v17, user) the letters in the colour of the member who pops up (MEW purple, HALO yellow, POPY red)
      const st = BUB(C(idolM).main, C(idolM).deep, hexA(C(idolM).deep, 0.5));
      // (v16, user: late) each letter on its own sung syllable, landing just before it (was up to 0.2 s after)
      const on = [t.ai, t.ii ?? t.ai + 0.34, t.doru, t.ru ?? t.doru + 0.34].map((x) => x - 0.07);
      ['ア', 'イ'].forEach((ch, i) => {
        const k = (T - on[i]) / 0.14;
        if (k > 0) drawGlyph(ctx, ch, st, 330, 1610, 260 - (LETTER_SPACING.idolStep - 320) / 2 + i * LETTER_SPACING.idolStep - (1 - easeOutCubic(clamp(k))) * 80, 0.08, 1, clamp(k * 4)); // (v31) spacing: tuning.ts LETTER_SPACING.idolStep
      });
      ['ド', 'ル'].forEach((ch, i) => {
        const k = (T - on[2 + i]) / 0.14;
        if (k > 0) drawGlyph(ctx, ch, st, 330, 320, 300 - (LETTER_SPACING.idolStep - 320) / 2 + i * LETTER_SPACING.idolStep - (1 - easeOutCubic(clamp(k))) * 80, -0.08, 1, clamp(k * 4));
      });
    },
  );
  if (cuts.sa - cuts.ai > 0.4) shots.push(starBurst(cuts.sa, C(idolM).main));

  // サインは: spins in the other way, mic swings in, syllables drop, arcs open on は
  add(
    cuts.sa,
    cuts.trio,
    'intro サインは',
    // continues the counter-clockwise turn out of the star burst, decelerating
    // (v16: the shot is longer now that it starts earlier; the turn keeps going slowly after it settles)
    // (v22, user: the turn stalled and then the camera eased back; no pull back, and the turn only ends on the
    // last frame of the shot) one deceleration over the whole shot: r = 1.9 (1 - u)^2.5, u = 0..1 - fast out of
    // the star burst, slowing all the way, still at the cut; the reference's zoom is off (z constant)
    ((ref: Rig): Rig => (T) => {
      const c = ref(T);
      // (v23, user: it should already be slowing well before the end and be about still for a short while
      // before the cut) the deceleration ends at 85 % of the shot: r = 1.9 (1 - u / 0.85)^2.5, then still
      // (v26, user: the mic should be turned into place sooner, in all three intros) SIGN_TURN_END of the shot
      const u = clamp((T - cuts.sa) / (cuts.trio - cuts.sa));
      return {...c, r: 1.9 * Math.pow(Math.max(0, 1 - u / SIGN_TURN_END), 2.5)}; // (v28) the spring is gone
    })(refRig(cuts.sa, cuts.trio, R, {ta: cuts.sa + 0.3, gain: {xy: 0.5, z: 0, r: 0}})),
    (ctx, T) => {
      bg(ctx, T, 16);
      const sw = easeOutBack(clamp((T - cuts.sa) / 0.17), 1.6); // (user: arrive sooner)
      mic(ctx, 700, 250, 1250, lerp(-1.6, -0.72, sw), {body: '#1e1d24', grille: '#8a8a95'});
      const rk = prog(T, cuts.sa + 0.06, cuts.sa + 0.5); // (v16) the arcs open with the word, not on は
      if (rk > 0)
        [RED, YEL, '#cfcfd8'].forEach((c, i) => {
          ctx.save();
          ctx.strokeStyle = c;
          ctx.lineWidth = 28 - i * 6;
          ctx.beginPath();
          ctx.arc(960, 540, 300 + i * 74 + 220 * easeOutCubic(rk), -1.2 + i, 1.5 + i);
          ctx.stroke();
          ctx.restore();
        });
    },
    (ctx, T) => {
      const st = (c: string, d: string) => BUB(c, d, hexA('#5a1630', 0.45));
      const letters: [string, number, string, string][] = [
        ['サ', t.sa, RED, '#c41f4e'],
        ['イ', t.i, PINK, '#c8306f'],
        ['ン', t.n, YEL, '#d98a00'],
        ['は', t.ha, '#b9b9c6', '#8a8a99'],
      ];
      // (v16, user) the four as ONE word, all at once (a single pop), right after the cut
      const k = (T - (cuts.sa + 0.05)) / 0.16;
      letters.forEach(([ch, _at, c, d], i) => {
        if (k > 0) drawGlyph(ctx, ch, st(c, d), 250, 640 + i * 250, 470 + i * 70 - (1 - easeOutCubic(clamp(k))) * 120, 0.22, easeOutBack(clamp(k), 2.4), clamp(k * 4));
      });
    },
  );

  // flower circle with a big B that becomes the transition: it pops with the circle, then flies at the camera
  // (v17, user) the B in the colour of this repetition's member, like the アイドル letters
  const BST: GStyle = BUB(C(idolM).main, C(idolM).deep, hexA(C(idolM).deep, 0.45));
  // No delayed letter or independent flight: the same transform and aperture apply to both layers.
  const b0 = t.b - 0.08;
  const bEnd = cuts.trio + Math.max(B_FLY.TAIL, FLOWER.HOLE);
  const MC0 = C(idolM);
  const petal = (ctx: Ctx, r0: number, ang0: number) => {
    for (let i = 0; i <= 120; i++) {
      const ang = (i / 120) * Math.PI * 2;
      const r = r0 * (1 + 0.13 * Math.sin((ang + ang0) * FLOWER.PETALS));
      if (i === 0) ctx.moveTo(960 + Math.cos(ang) * r, 560 + Math.sin(ang) * r);
      else ctx.lineTo(960 + Math.cos(ang) * r, 560 + Math.sin(ang) * r);
    }
    ctx.closePath();
  };
  /** The flower of radius R; `hole` = radius of the flower-shaped hole in its middle (0 = none). */
  const flower = (ctx: Ctx, R: number, ang0: number, hole: number, alpha: number) => {
    if (R <= 1 || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (hole > 0) {
      // everything outside the hole (even-odd: the frame minus the hole)
      ctx.beginPath();
      ctx.rect(-W, -H, W * 3, H * 3);
      petal(ctx, hole, -ang0);
      ctx.clip('evenodd');
    }
    ctx.shadowColor = hexA(MC0.deep, 0.35);
    ctx.shadowBlur = Math.min(60, R * 0.08);
    ctx.shadowOffsetY = Math.min(24, R * 0.03);
    ctx.beginPath();
    petal(ctx, R * 1.06, ang0);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    petal(ctx, R, ang0);
    ctx.fillStyle = MC0.main;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(960, 560, R * FLOWER.DISC + Math.min(40, R * 0.04), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(960, 560, R * FLOWER.DISC, 0, Math.PI * 2);
    ctx.fillStyle = MC0.light;
    ctx.fill();
    ctx.restore();
    if (hole > 0) {
      // the white rim of the hole
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      petal(ctx, hole, -ang0);
      ctx.lineWidth = FLOWER.RIM;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
  };
  shots.push({
    a: b0,
    b: bEnd,
    z: 9,
    label: 'flower B',
    draw: (ctx, T) => {
      const lt = T - b0;
      const cutT = cuts.trio - b0;
      const o0 = B_FLY.POP + FLOWER.OPEN_AT;
      const grow = clamp((lt - o0) / Math.max(0.05, cutT - o0));
      const fly = clamp((lt - cutT) / B_FLY.TAIL);
      const coverScale = FLOWER.COVER / FLOWER.R;
      const pop = Math.max(0, easeOutBack(clamp(lt / B_FLY.POP), 2.2));
      const scale = lt < cutT
        ? pop * Math.exp(Math.log(coverScale) * grow * grow)
        : coverScale * Math.exp(Math.log(B_FLY.END / coverScale) * fly * fly);
      const turn = FLOWER.SPIN * lt + FLOWER.FLY_SPIN * grow * grow;
      const reveal = clamp((lt - cutT) / FLOWER.HOLE);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // One aperture cuts through the complete badge, including the B.
      if (reveal > 0) {
        ctx.beginPath();
        ctx.rect(-W, -H, W * 3, H * 3);
        petal(ctx, 1500 * Math.pow(reveal, 1.2), -turn);
        ctx.clip('evenodd');
      }
      ctx.globalAlpha = clamp(lt / 0.04);
      ctx.translate(960, 560);
      ctx.rotate(turn * 0.15);
      ctx.scale(scale, scale);
      ctx.translate(-960, -560);
      flower(ctx, FLOWER.R, 0, 0, 1);
      drawGlyph(ctx, 'B', BST, 640, 960, 560, -0.06, B_FLY.HOLD, 1);
      ctx.restore();
    },
  });

  // the three, staggered and tilted; halfway through B a quick turn and push (then slow)
  add(
    cuts.trio,
    cuts.chu,
    'intro trio',
    // the reference camera here: a turn of about -13 deg and a push of 1.15 halfway through B
    ((ref: Rig): Rig => (T) => {
      const c = ref(T);
      return {...c, z: c.z * Math.exp(0.04 * (T - cuts.trio)) * (1 - 0.15 * Math.exp(-(T - cuts.trio) / 0.15)), r: 0.1 - 0.05 * (T - cuts.trio)}; // a slow push, turning counter-clockwise
    })(refRig(cuts.trio, cuts.chu, {x: 960, y: 540, z: 1.0, r: 0.1}, {ta: cuts.trio + 0.05, gain: {xy: 0, z: 0, r: 0}})), // (v15, user: a slight sideways shake) the reference's measured sideways motion is noise here: off
    (ctx, T) => {
      // v33: fixed original pink background in all three repetitions.
      ctx.fillStyle = '#ffd6e2';
      ctx.fillRect(-W, -H, W * 3, H * 3);
      bg(ctx, T, 17, PINK, 0.25);
      const lt = T - cuts.trio;
      // hearts behind
      neonHeart(ctx, 1700, 240 - lt * 20, 220, LAV, 0.15);
      neonHeart(ctx, 260, 250 - lt * 25, 180, PINK, -0.2);
      const sides = ORDER.filter((m) => m !== idolM);
      figAt(ctx, sides[0], 'full_laugh', 470, 300, 235);
      figAt(ctx, sides[1], 'full_laugh', idolM === 'mew' ? 1510 : 1450, idolM === 'mew' ? 490 : 320, 235);
      // The current lead is drawn last, at the front and in the centre.
      figAt(ctx, idolM, 'full_wink', 960, 440, 255);
      // hearts in front at the bottom corners
      neonHeart(ctx, 230, 880 - lt * 15, 300, YEL, -0.25);
      neonHeart(ctx, 1680, 900 - lt * 18, 260, PINK, 0.2);
      sparkles(ctx, T, 171, 14, [YEL, '#ffffff', PINK], {x: 0, y: 0, w: W, h: H}, [14, 34]);
    },
  );

  // CHU! around the singer's face (the チュッ singer from the SVP)
  // v45: portrait-only ease-out over the whole shot; ends at rest with no drift.
  const chuPortraitZoom = (T: number) => {
    // (v43, user: she does not move; at her place from the first frame) CHU_CAMERA.move
    if (!CHU_CAMERA.move) return CHU_CAMERA.endZoom;
    const u = clamp((T - cuts.chu) / Math.max(0.001, cuts.title - cuts.chu));
    const eased = 1 - Math.pow(1 - u, Math.max(1, CHU_CAMERA.easeOutPower));
    return lerp(CHU_CAMERA.startZoom, CHU_CAMERA.endZoom, eased);
  };
  // (v33, user chose "B: the signed card"; v34, user: under 1 s there is no time to take a photo AND sign it -
  // nothing could be read) no photo step: the portrait fills the frame the whole time (it is the signed picture)
  // and from the cut on she signs right across it with her colour marker - "CHU!", a heart, her name - big, with
  // a white edge so it reads on any ground. Timings and sizes: tuning.ts CHU_SIGN.
  // (v57, user chose "2"; v58 redone) her own A-section page ground behind her (HALO yellow beams and stripes, POPY
  // red-white checker, MEW purple with white diamonds and trusses: the same drawing as her A-section page), a little
  // out of focus, and a glow of her colour behind her head. Parameters: tuning.ts CHU_BG.
  const ground = (g: Ctx, T: number, m: Member) => {
    const B = CHU_BG;
    const Tg = B.still ? cuts.chu : T;
    const {c: lc, g: lg} = layer('chuGround');
    lg.save();
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    lg.translate(960, 540);
    lg.scale(B.zoom, B.zoom);
    lg.translate(-960, -540);
    capsuleGround(lg, Tg, CAP_OF[m], CAP_PAGE[m], {pens: B.pens, sparkles: B.sparkles});
    lg.restore();
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = C(m).light; // under the blurred edges
    g.fillRect(0, 0, W, H);
    drawBlurred(g, lc, B.blur);
    // her colour's light: a soft glow centred behind her head, screened over the pattern (the pattern stays visible)
    if (B.light > 0) {
      const P = CHU_PORTRAIT[m];
      const fy = (m === 'mew' ? 400 : 600) + P.dy;
      const x = 960 + P.dx + B.lightX, y = fy + B.lightY;
      const lgr = g.createRadialGradient(x, y, 0, x, y, B.lightR);
      lgr.addColorStop(0, hexA(C(m).light, 1));
      lgr.addColorStop(0.35, hexA(C(m).light, 0.75));
      lgr.addColorStop(0.7, hexA(C(m).main, 0.35));
      lgr.addColorStop(1, hexA(C(m).main, 0));
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = clamp(B.light);
      g.fillStyle = lgr;
      g.fillRect(0, 0, W, H);
    }
    g.restore();
    if (B.veil > 0) white(g, B.veil);
  };
  // MEW: a smaller, higher fixed framing keeps both heart hands inside the shot.
  const portrait = (g: Ctx, m: Member, zoom: number) => {
    const fh = m === 'mew' ? 430 : 540;
    const fy = m === 'mew' ? 400 : 600;
    // (v42, user) each member's face position on the CHU frame: tuning.ts CHU_PORTRAIT
    const P = CHU_PORTRAIT[m];
    faceShot(g, m, kissOf(m), 960 + P.dx, fy + P.dy, fh * zoom * P.scale);
  };
  /** Marker text: a white edge under the ink, so it reads on hair, skin or ground. */
  // (v45, user: the CHU lettering was jagged next to the lyrics) through drawGlyph, the same supersampled glyph
  // sprites as every lyric (LYRIC_RASTER), not canvas text drawn straight on the rotated frame. Same look: Yusei,
  // member's deep ink, a white edge. x, y = left end of the text on its baseline, as before.
  const ink = (g: Ctx, text: string, x: number, y: number, size: number, col: string) => {
    const st: GStyle = {fill: col, stroke2: '#ffffff', sw2: 0.08, weight: 400};
    g.font = `400 ${size}px YUSEI`;
    let cx = x;
    for (const ch of text) {
      const w = g.measureText(ch).width;
      drawGlyph(g, ch, st, size, cx + w / 2, y - size * 0.36);
      cx += w;
    }
  };
  /** The signature in screen space; k = 0..1 of the writing. */
  const signature = (g: Ctx, m: Member, k: number) => {
    if (k <= 0) return;
    const col = C(m).deep;
    const S = CHU_SIGN.size;
    g.save();
    g.translate(CHU_SIGN.x, CHU_SIGN.y);
    g.rotate(CHU_SIGN.rot);
    g.textBaseline = 'alphabetic';
    g.font = `400 ${S}px YUSEI`;
    const word = 'CHU!';
    const kw = clamp(k / 0.6);
    let x = 0;
    for (let i = 0; i < word.length; i++) {
      const w = g.measureText(word[i]).width;
      const ki = clamp(kw * word.length - i);
      if (ki > 0) {
        // each letter wiped in left to right like a pen stroke, with a little pop as the pen lands
        g.save();
        g.beginPath();
        g.rect(x - S * 0.12, -S * 1.1, (w + S * 0.24) * ki, S * 1.5);
        g.clip();
        const pop = 1 + 0.12 * Math.exp(-ki * 4) * (ki < 1 ? 1 : 0);
        g.translate(x + w / 2, -S * 0.35);
        g.scale(pop, pop);
        g.translate(-(x + w / 2), S * 0.35);
        ink(g, word[i], x, 0, S, col);
        g.restore();
      }
      x += w * 0.94;
    }
    // the heart, in one stroke (white edge first)
    const kh = clamp((k - 0.6) / 0.22);
    if (kh > 0) {
      const hx = x + S * 0.42;
      const hy = -S * 0.45;
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.setLineDash([S * 6 * kh, S * 12]);
      heartPath(g, hx, hy, S * 0.4);
      g.lineWidth = S * 0.16;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.lineWidth = S * 0.075;
      g.strokeStyle = col;
      g.stroke();
      g.restore();
    }
    // her name, smaller, under it
    const kn = clamp((k - 0.82) / 0.18);
    if (kn > 0) {
      const ns = S * 0.4;
      g.font = `400 ${ns}px YUSEI`;
      const nm = NAMES[m];
      const nw = g.measureText(nm).width;
      g.save();
      g.beginPath();
      g.rect(x - nw * 0.4 - 10, S * 0.05, (nw + 20) * kn, ns * 1.3);
      g.clip();
      ink(g, nm, x - nw * 0.4, S * 0.05 + ns, ns, col);
      g.restore();
    }
    g.restore();
  };
  const chuFrame = (ctx: Ctx, T: number) => {
    ground(ctx, T, chuM);
    portrait(ctx, chuM, chuPortraitZoom(T));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    signature(ctx, chuM, clamp((T - cuts.chu - CHU_SIGN.start) / CHU_SIGN.dur));
    ctx.restore();
  };
  add(
    cuts.chu,
    cuts.title,
    `intro CHU ${chuM}`,
    // Background and lettering stay in screen space; only the portrait changes size.
    () => R,
    chuFrame,
  );
  // (v35, user: at CHU it is not a card yet; on the transition it becomes the signed card and flies away - later
  // and slower, when the next beat comes in) the frame stays whole past the cut until flyAt, then shrinks into a
  // white-edged card that tips and flies off to the upper right, accelerating, over the next shot
  // (v44, user: the white flash goes between the サインはB trio and the CHU) rises before the cut into the CHU,
  // full at the cut, clears after it (CHU_FLASH); the CHU -> next shot keeps the signed card flying off
  {
    const F = CHU_FLASH;
    const at = cuts.chu;
    shots.push({
      a: at - F.flashIn,
      b: at + F.flashOut,
      z: 15,
      label: `CHU flash ${chuM}`,
      draw: (ctx, T) => {
        const v = T < at ? (F.flashIn > 0 ? Math.pow(prog(T, at - F.flashIn, at), 1.6) : 1) : F.flashOut > 0 ? Math.pow(1 - prog(T, at, at + F.flashOut), 1.4) : 0;
        if (v <= 0) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = Math.min(1, v * F.peak);
        ctx.fillStyle = '#fff8fc';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      },
    });
  }
  shots.push({
    a: cuts.title,
    b: flyAt + CHU_SIGN.total,
    z: 15,
    label: `CHU card ${chuM}`,
    draw: (ctx, T) => {
      const {c, g} = layer('chuCard');
      g.setTransform(1, 0, 0, 1, 0, 0);
      chuFrame(g, T);
      const f = clamp((T - flyAt) / CHU_SIGN.total);
      const s1 = easeInOut(clamp(f / CHU_SIGN.cardShare));
      const s2 = Math.pow(clamp((f - CHU_SIGN.flyFrom) / (1 - CHU_SIGN.flyFrom)), 2);
      const sc = lerp(1, CHU_SIGN.cardScale, s1) * (1 - 0.25 * s2);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(W / 2 + CHU_SIGN.flyX * s2, H / 2 + CHU_SIGN.flyY * s2);
      ctx.rotate(-0.09 * s1 + CHU_SIGN.spin * s2);
      ctx.scale(sc, sc);
      ctx.translate(-W / 2, -H / 2);
      if (s1 > 0) {
        // the card: a white edge round the picture, a deeper strip at the bottom, a soft shadow
        const e = 46;
        ctx.save();
        ctx.shadowColor = hexA(C(chuM).deep, 0.4 * s1);
        ctx.shadowBlur = 60;
        ctx.shadowOffsetY = 24;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-e, -e, W + 2 * e, H + e + 150);
        ctx.restore();
      }
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    },
  });

  // title: the singer's pink silhouette fades, the three stack in one by one behind colour wipes,
  // the title letters drop in grey and are coloured by a sweep
  const order: Member[] = [chuM, ...ORDER.filter((m) => m !== chuM)];
  // the same stand as the bridge trio (2:40): MEW up and left, so POPY's raised arm never crosses her face
  // (v28, user: POPY's hand covered MEW's face a little and she sat right of centre) POPY up 70 and left 30
  const POS: Record<Member, [number, number, number]> = {mew: [470, 300, 235], popy: [990, 430, 258], halo: [1420, 320, 235]};
  add(
    cuts.title,
    end,
    'intro title',
    // (v15, user) before the cut: accelerating turn and push, large (into the credits, which arrive turning the
    // same way)
    // the roll keeps the CHU shot's counter-clockwise way all through (the credits after it arrive on a [turn])
    // (v16, user: too many push-and-turn cuts) no push into the credits: the credits' spotlights swing in, cross
    // and flood the cut (tCredits9: beamCross); the camera keeps its slow push under it
    live(cuts.title, end, {...R, r: -0.04}, {enter: {z: 0.9, r: 0.05}, drift: {z: 0.04, r: -0.012}}),
    (ctx, T) => {
      bg(ctx, T, 20, PINK, 0.05);
      const lt = T - titleT; // (v35) after the CHU card has left
      // draw back to front: halo, mew, popy (popy lowest = nearest)
      (['halo', 'mew', 'popy'] as Member[]).forEach((m) => {
        const i = order.indexOf(m);
        const t0 = i * 0.26; // (v15, user: slower) was 0.2 / 0.22
        const k = clamp((lt - t0) / 0.38);
        if (k <= 0) return;
        const [x, y, f] = POS[m];
        const dx = (1 - easeOutCubic(k)) * (i % 2 ? -500 : 500);
        const colA = clamp((lt - t0 - 0.2) / 0.2);
        if (colA < 1) figAt(ctx, m, 'full', x + dx, y, f, 'silhouette', MC[m][0]);
        if (colA > 0) figAt(ctx, m, ({mew: 'full_laugh', popy: 'full_wink', halo: 'full_laugh'} as Record<Member, Kind>)[m], x + dx, y, f, 'color', undefined, undefined, {alpha: colA});
      });
      sparkles(ctx, T, 201, 22, [YEL, '#ffffff', PINK], {x: 0, y: 0, w: W, h: H}, [14, 40]);
      // (v35) the CHU singer's pink silhouette fading out here is gone: the signed card carries the cut now
    },
    (ctx, T) => {
      floatGlow(ctx, T, 31, titleT);
      titleFancy(ctx, 960, 860, 0.95, T, titleT + 0.5);
    },
  );

  return {shots, fx: [...blurOf(rigs), flashAt(cuts.trio, 0.25, 0.5)]}; // (v35) no flash on the CHU cut: the card carries it
};

// ---------------------------------------------------------------- spotlight stage (credits, reprise tour, interlude push)

/** Scene: idol tiles drifting like a curtain, three swaying spotlights, the members in them, the crowd's penlights. */
// stage order in the spotlights (user): MEW left, POPY centre, HALO right
const SPOT_M: Member[] = ['mew', 'popy', 'halo'];
const SPOT_X = [330, 960, 1590];
const SPOT_Y = [430, 470, 430];
const SPOT_C = [LAV, '#ff7aa0', YEL];

/** (v35) The spotlight stage's frame: towers (scene x) and the top of the towers (y, above the upper truss).
 *  (v36, user) no dark hall outside the frame any more: the background runs on, only the steel ends. */
const STAGE_TOWERS = [0, 640, 1280, 1920];
const STAGE_TOP = -250;
/** (v36) y of the upper truss (the one the three follow-spots hang from): top chord / bottom chord */
const UPPER_TRUSS = {top: -204, bottom: -152};
/** (v36, user: the upper row of lamps hung in the air) the upper truss is a real truss, the same build as the
 *  lower one, running between the outer towers and sitting on them with end blocks. */
const upperTruss = (ctx: Ctx, alpha = 1) => {
  const L = STAGE_TOWERS[0];
  const Rr = STAGE_TOWERS[STAGE_TOWERS.length - 1];
  const {top: y0, bottom: y1} = UPPER_TRUSS;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = hexA('#bfaed6', 0.95);
  ctx.fillRect(L - 40, y0, Rr - L + 80, 14);
  ctx.fillRect(L - 40, y1 - 12, Rr - L + 80, 12);
  ctx.strokeStyle = hexA('#bfaed6', 0.95);
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let x = L + 46; x < Rr - 46 - 43; x += 44) {
    ctx.moveTo(x, y0 + 7);
    ctx.lineTo(x + 22, y1 - 6);
    ctx.lineTo(x + 44, y0 + 7);
  }
  ctx.stroke();
  // end blocks on the outer towers, clamps where the inner towers pass through
  STAGE_TOWERS.forEach((tx, i) => {
    const outer = i === 0 || i === STAGE_TOWERS.length - 1;
    ctx.fillRect(tx - (outer ? 46 : 38), y0 - 8, outer ? 92 : 76, y1 - y0 + 14);
  });
  ctx.restore();
};
/** caps on the tower tops */
const towerCaps = (ctx: Ctx, alpha = 1) => {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = hexA('#bfaed6', 0.95);
  STAGE_TOWERS.forEach((tx) => ctx.fillRect(tx - 42, STAGE_TOP - 10, 84, 14));
  ctx.restore();
};
/** Truss across the top with moving-head lamps and a garland of star bulbs (fills the top of wide shots). */
const topRig = (ctx: Ctx, T: number, alpha = 1) => {
  ctx.save();
  ctx.globalAlpha *= alpha;
  // (v17: the tour's exit travels far right and up: the rig runs on well past the frame)
  // (v35) between the outer towers only
  const L = STAGE_TOWERS[0];
  const Rr = STAGE_TOWERS[STAGE_TOWERS.length - 1];
  ctx.fillStyle = hexA('#d6c6e6', 0.9);
  ctx.fillRect(L - 40, 18, Rr - L + 80, 14);
  ctx.fillRect(L - 40, 62, Rr - L + 80, 14);
  // end blocks where the truss sits on the towers
  ctx.fillRect(L - 46, 10, 92, 74);
  ctx.fillRect(Rr - 46, 10, 92, 74);
  ctx.strokeStyle = hexA('#d6c6e6', 0.9);
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let x = L + 46; x < Rr - 46 - 43; x += 44) {
    ctx.moveTo(x, 25);
    ctx.lineTo(x + 22, 69);
    ctx.lineTo(x + 44, 25);
  }
  ctx.stroke();
  // lamps: blink in a slow chase (two bars per lap), never all at once
  for (let i = -7; i < 16; i++) {
    const x = 120 + i * 210;
    if (x < L + 60 || x > Rr - 60) continue;
    const on = 0.5 + 0.5 * Math.sin(T * 2.4 - i * 0.9);
    ctx.fillStyle = '#5a4870';
    ctx.beginPath();
    ctx.roundRect(x - 34, 76, 68, 54, 14);
    ctx.fill();
    const g = ctx.createRadialGradient(x, 116, 0, x, 116, 90);
    g.addColorStop(0, hexA('#ffffff', 0.95 * on));
    g.addColorStop(0.3, hexA(SPOT_C[((i % 3) + 3) % 3], 0.6 * on));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 90, 26, 180, 180);
  }
  // garland: star bulbs hanging in shallow arcs between the lamps, swaying a little
  for (let j = -7; j < 15; j++) {
    const x0 = 120 + j * 210;
    if (x0 < L + 60 || x0 + 210 > Rr - 60) continue;
    const sway = Math.sin(T * 1.1 + j) * 6;
    ctx.strokeStyle = hexA('#ffffff', 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let u = 0; u <= 1.001; u += 0.1) ctx.lineTo(x0 + u * 210, 132 + Math.sin(u * Math.PI) * (46 + sway));
    ctx.stroke();
    for (let q = 1; q < 5; q++) {
      const u = q / 5;
      const tw = 0.6 + 0.4 * Math.sin(T * 3 + j * 1.7 + q * 2.1);
      ctx.save();
      ctx.shadowColor = SPOT_C[(((j + q) % 3) + 3) % 3];
      ctx.shadowBlur = 18 * tw;
      ctx.fillStyle = [YEL, '#ffffff', PINK][(((j + q) % 3) + 3) % 3];
      star4(ctx, x0 + u * 210, 150 + Math.sin(u * Math.PI) * (46 + sway), 15, 0.32, 0);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
};

/** A follow-spot fixture hanging from the upper truss, its lens where the beam starts (v17, user: the coloured
 *  beams came out of nothing when the camera pulled back). The head turns with its beam. */
const spotFixture = (ctx: Ctx, x: number, y: number, rot: number, col: string, on: number) => {
  ctx.save();
  // the hanging yoke (v36: the truss itself is upperTruss, drawn once for the whole stage)
  ctx.fillStyle = hexA('#bfaed6', 0.95);
  ctx.fillRect(x - 6, UPPER_TRUSS.bottom - 4, 12, y - 50 - UPPER_TRUSS.bottom + 4);
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#5a4870';
  ctx.beginPath();
  ctx.roundRect(-48, -64, 96, 70, 18);
  ctx.fill();
  ctx.fillStyle = '#463860';
  ctx.fillRect(-56, -40, 112, 12);
  const g = ctx.createRadialGradient(0, 4, 0, 0, 4, 90);
  g.addColorStop(0, hexA('#ffffff', 0.95 * on));
  g.addColorStop(0.3, hexA(col, 0.75 * on));
  g.addColorStop(1, hexA(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-90, -86, 180, 180);
  ctx.restore();
};

/** Spotlight stage in reference-1 tones. Animated background (turning rays, rising glow stars, bokeh,
 *  curtain folds), top rig, three beams that start as thin lines and open to full width as each member
 *  rises into them; names stand above the heads (`names`). */
const beamScene = (ctx: Ctx, T: number, a: number, o: {lift?: (T: number, id: number, phase: number) => number; rise?: number; amp?: number; appear?: number; trussA?: number; names?: boolean; thin?: boolean; face?: (m: Member, T: number) => Kind; chase?: boolean; lampOn?: number[]; sweep?: number | ((T: number) => number); hops?: number[]} = {}) => {
  bg(ctx, T, 30, undefined, 0, 40, 0);
  // slowly turning rays behind everything
  ctx.save();
  ctx.globalAlpha = 0.28;
  sunburst(ctx, 960, -60, 22, '#ffd3e6', T * 0.08);
  ctx.restore();
  // soft vertical folds drifting (the curtain)
  ctx.save();
  for (let i = -2; i < 14; i++) {
    const x = i * 170 + ((T * 30) % 170);
    const g = ctx.createLinearGradient(x, 0, x + 170, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, -H, 170, H * 3);
  }
  ctx.restore();
  floatGlow(ctx, T, 61, a, 14);
  // (v35, user: on the tour's exit to the upper right the trusses ran on for ever, sideways and up, with extra
  // towers on the right) the stage is a closed frame: four towers from the upper truss down to the floor, the
  // trusses end at the outer towers, and past them is the dark of the hall
  // (v36, user) no dark outside the frame; the upper truss sits on the towers like the lower one
  STAGE_TOWERS.forEach((tx) => truss(ctx, tx, STAGE_TOP, H + 300, 60, hexA('#d6c6e6', o.trussA ?? 0.6)));
  towerCaps(ctx, o.trussA === undefined ? 1 : Math.max(0.5, o.trussA));
  upperTruss(ctx, o.trussA === undefined ? 1 : Math.max(0.5, o.trussA));
  const t0s = SPOT_M.map((_, i) => a + (o.appear ?? 0.35) + i * 0.22);
  // beams: a thin line until the member rises, then open to full width (decelerating)
  SPOT_X.forEach((x, i) => {
    const w = o.thin === false ? 1 : easeOutCubic(clamp((T - t0s[i] + 0.05) / 0.5));
    // sweep: the beams swing across each other on a four-beat figure (light show); lampOn: each beam snaps on
    const swA = typeof o.sweep === 'function' ? o.sweep(T) : o.sweep;
    const sw = swA ? Math.sin((2 * Math.PI * (T - a)) / (4 * BEAT) + i * 2.1) * swA : Math.sin(T * 0.7 + i * 2) * 0.06;
    const on = o.lampOn ? clamp((T - o.lampOn[i]) / 0.06) : 1;
    if (on <= 0) {
      spotFixture(ctx, x, -80, sw, SPOT_C[i], 0); // (the fixture is there before its lamp snaps on)
      return;
    }
    // chase: the three beams brighten one after another on the beat (two beats each)
    const ch = o.chase ? 0.75 + 0.25 * Math.cos(((T / (2 * BEAT) - i) * 2 * Math.PI) / 3) : 1;
    beam(ctx, x, -80, lerp(10, i === 1 ? 130 : 150, w), lerp(26, i === 1 ? 700 : 840, w), hexA(SPOT_C[i], 0.95 * ch * on), sw, lerp(0.8, 1, w));
    spotFixture(ctx, x, -80, sw, SPOT_C[i], on);
  });
  // members rise into their light one by one: white silhouette first, then colour
  SPOT_M.forEach((m, i) => {
    const k = clamp((T - t0s[i]) / 0.3);
    if (k <= 0) return;
    const x = SPOT_X[i];
    const y = SPOT_Y[i] + (1 - easeOutBack(k, 1.4)) * 500;
    const col = clamp((T - t0s[i] - 0.25) / 0.2);
    const lit = o.lampOn ? clamp((T - o.lampOn[i]) / 0.06) : 1;
    // a jump (full-body: up 70 px over 0.36 s, squash on landing), a little after each other
    let hy = 0;
    let sq = 1;
    (o.hops ?? []).forEach((t0) => {
      const u = (T - t0 - i * 0.04) / 0.36;
      if (u > 0 && u < 1) hy -= 70 * Math.sin(Math.PI * u);
      const l = T - t0 - i * 0.04 - 0.36;
      if (l > 0 && l < 0.3) sq = 1 - 0.07 * Math.exp(-l * 12) * Math.cos(l * 30);
    });
    ctx.save();
    ctx.translate(x, y + 92 * 7.5);
    ctx.scale(1 / Math.sqrt(sq), sq);
    ctx.translate(-x, -(y + 92 * 7.5));
    if (lit < 1) figAt(ctx, m, 'full', x, y + hy, 92, 'silhouette', '#2b1d3a', undefined, {shadow: 0});
    if (col < 1 && lit > 0) figAt(ctx, m, 'full', x, y + hy, 92, 'silhouette', '#ffffff', undefined, {shadow: 0, alpha: lit});
    if (col > 0 && lit > 0) figAt(ctx, m, o.face?.(m, T) ?? 'full', x, y + hy, 92, 'color', undefined, undefined, {alpha: col * lit});
    ctx.restore();
    // the name stands above the head, letter by letter, then floats gently
    if (o.names) {
      const chars = Array.from(NAMES[m]);
      const st = BIGTXT(m);
      chars.forEach((ch, j) => {
        const kj = clamp((T - (t0s[i] + 0.35 + j * 0.05)) / 0.22);
        if (kj <= 0) return;
        const bob = Math.sin((T - a) * 2.2 + i * 1.4 + j * 0.6) * 5;
        const gx = x + (j - (chars.length - 1) / 2) * 62;
        const gy = SPOT_Y[i] - 175 + bob - (1 - easeOutCubic(kj)) * 60;
        drawGlyph(ctx, ch, st, 80, gx, gy, (j % 2 ? 0.05 : -0.05) * (1 - kj) + (i - 1) * 0.04, easeOutBack(kj, 2.4), clamp(kj * 3));
      });
    }
  });
  topRig(ctx, T, o.trussA === undefined ? 1 : Math.max(0.5, o.trussA));
  paper(ctx, T, a, 32, 30, [RED, YEL, PINK, '#ffffff']);
  // (v17, user: pulled back, the penlights floated) held by an audience, and the crowd runs on to the sides
  // (v42) lift: the crowd answering the calls (same springs as 2:36, CROWD_CALLS)
  // (v43, user) with lift (the credits, 0:14-0:18): the beat-locked swing, one cycle a bar, the hops on the calls,
  // and the near row lower (its big yellow one stood too high)
  const CC = CROWD_CALLS;
  penCrowd(ctx, T, {seed: 4, rise: o.rise ?? 1, amp: o.amp ?? 0.16, colors: [PINK, YEL, RED, LAV, '#ffffff'], people: true, wide: 0.8, ...(o.lift ? {beats: CC.swayBeats, sync: {spread: CC.phaseSpread}, nearDrop: CC.creditsNearDrop, lift: (id: number, ph: number) => o.lift!(T, id, ph), liftRef: CC.height * CC.creditsScale, straighten: CC.straighten} : {})});
};

/** Spotlights crossing over a cut at `at` (v17, user: no curtain - an idol stage has none; light instead). The
 *  three stage spotlights of the credits (MEW lavender, POPY pink, HALO yellow, from the truss above the frame)
 *  swing in over the title, opening wider and wider; they cross in the middle and their coloured light fills the
 *  frame at the cut; then they swing back apart onto their own places and narrow down to the beams of the
 *  credits scene, which take over. The light comes from above and belongs to the next scene. */
const beamCross = (at: number, pre = 0.5, post = 0.42): Shot => ({
  a: at - pre,
  b: at + post,
  z: 10,
  label: 'spotlights cross',
  draw: (ctx, T) => {
    const before = T < at;
    // u: 0 far apart / thin -> 1 crossed and wide (at the cut)
    const u = before ? Math.pow(prog(T, at - pre, at), 1.6) : 1 - easeOutCubic(prog(T, at, at + post));
    if (u <= 0.002) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // coloured light, not white: on the pale title a white (screen) beam would not show and the cut would read
    // as a white flash. Each cone is its member's colour, strongest near its lamp; where they cross they mix.
    SPOT_X.forEach((x0, i) => {
      const sx = x0;
      const sy = -520;
      const side = i - 1;
      const aimX = lerp(x0 + side * 1100, 960 - side * 240, u);
      const ang = Math.atan2(aimX - sx, H + 300 - sy);
      const half = lerp(0.04, 0.8, Math.pow(u, 1.2)); // half-angle of the cone
      const len = 2900;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-ang);
      const col = SPOT_C[i];
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, hexA('#ffffff', 0.9));
      g.addColorStop(0.2, hexA(col, lerp(0.55, 0.8, u)));
      g.addColorStop(1, hexA(col, lerp(0.25, 0.72, u)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(18, 0);
      ctx.lineTo(Math.tan(half) * len, len);
      ctx.lineTo(-Math.tan(half) * len, len);
      ctx.closePath();
      ctx.fill();
      // a bright core along the beam
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = hexA('#ffffff', 0.35 * u);
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.lineTo(Math.tan(half * 0.25) * len, len);
      ctx.lineTo(-Math.tan(half * 0.25) * len, len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  },
});

export const tCredits9 = (a: number, b: number, calls: number[], ends?: number[]): Part => {
  // (v42, user) the penlights already on screen answer the calls like those at 2:36; (v43) the same beat-locked
  // swing (v44: no hops - held up on the calls, callRaise)
  // (v46) one closed loop per pair of calls, on each stick's own swing (callRaise)
  const raise = ends ? callRaise(calls.map((t) => ({t}))) : undefined;
  const lift = raise ? (T: number, id: number, ph: number) => raise(T, id, ph) * CROWD_CALLS.creditsScale : undefined;
  // arrives turning and pulling back, drifts on (slow push and roll), leaves accelerating into the spoken lines
  // the picture travels right and turns clockwise (into the spoken lines, which keep that direction)
  // one direction per channel: from wider and turned back, pushing in and turning clockwise, faster out
  const rig = live(a, b, {x: W / 2, y: H / 2, z: 1.0, r: -0.035}, {enter: {z: 0.82, r: -0.09, dy: -60}, drift: {z: 0.03, r: 0.012}, exit: CREDITS_OUT.mode === 'push' ? {z: CREDITS_OUT.zoom, r: CREDITS_OUT.rot} : {z: CREDITS_OUT.upRight.zoom, dx: CREDITS_OUT.upRight.dx, dy: CREDITS_OUT.upRight.dy, r: CREDITS_OUT.rot}, outDur: b - (penSwingWindow().a - CREDITS_OUT.lead), tauOut: CREDITS_OUT.tau}); // (v53, user: an accelerating move into the penlight swing) CREDITS_OUT // (user: push and turn harder into the cut) (v19, user: no turn here) the camera drops toward the crowd, faster and faster, while their penlights rise and flood the lens
  // (v59, user) no B小町！/ フッフー！ lettering here any more: the penlights alone answer the calls
  const shots: Shot[] = [
    {...camShot(
      a,
      b,
      'credits',
      rig,
      (ctx, T) => {
        beamScene(ctx, T, a, {lift, rise: clamp((T - a - 0.25) / 0.7), names: true, amp: CROWD_CALLS.creditsSway, hops: [calls[0], calls[2]].filter((x) => x !== undefined), face: (_m, T2) => (calls[0] !== undefined && T2 >= calls[0] + 0.17 ? 'full_laugh' : 'full')});
      },
    ), turn: true}, // the iris wipe hides the change of direction (the intro travels left, the spoken lines right)
    // (v17, user: no curtain) the three spotlights of the credits swing in over the title, cross and flood the
    // cut with their light, then swing back onto their places
    beamCross(a),
    // (v46, user) the transition into the spoken lines is one red penlight swung across the lens:
    // joinPenlightSwing in direction.ts (penlightWipe.ts)
  ];
  return {shots, fx: [rigBlur(rig, a, b)]};
};

/** After the reprise: the camera visits each spotlight close, then pulls back; penlights rise; star burst out. */
export const tTour = (a: number, b: number, o: {jumpAt?: number; callAt?: number} = {}): Part => {
  const t1 = a + (b - a) * 0.15;
  const t2 = a + (b - a) * 0.3;
  const t3 = a + (b - a) * 0.45;
  // each spotlight close and tilted, still creeping while there; the moves between them accelerate and
  // decelerate (io) and flip the roll; the pull back keeps turning slowly to the end
  // the same visits as before, played as one continuous path (never stops at a spotlight)
  const visits = keysFlow([
    {t: a, x: 300, y: 420, z: 2.8, r: -0.16},
    {t: a + 0.35, x: 330, y: 385, z: 2.4, r: -0.08, e: 'out'},
    {t: t1, x: 365, y: 372, z: 2.46, r: -0.06, e: 'lin'},
    {t: t1 + 0.35, x: 960, y: 405, z: 2.35, r: 0.08, e: 'io'},
    {t: t2, x: 995, y: 392, z: 2.42, r: 0.06, e: 'lin'},
    {t: t2 + 0.35, x: 1590, y: 385, z: 2.35, r: -0.07, e: 'io'},
    {t: t3, x: 1555, y: 372, z: 2.42, r: -0.05, e: 'lin'},
  ]);
  // (v16, user: the pull back changed speed in two steps, and the move to the upper right came too late, with no
  // build) from the third spotlight on, ONE move: a critically damped pull back (it gathers speed from the
  // creep, peaks, and eases into a slow drift - no corner), the drift carries on, and from 1.7 s before the
  // cut an exponential ramp to the upper right lies on top (seen building from early on)
  const P3 = visits(t3);
  const W0 = {x: 905, y: 548, z: 0.95, r: 0.08};
  const TAU = TOUR_PULL.tau; // (v31, user: fast first, then slow) tuning.ts TOUR_PULL
  const OUT = 2.0;
  const pull: Rig = (T) => {
    const t = Math.max(0, T - t3);
    // (v31, user: the pull back from HALO was too even - fast first, then slow) a first-order ease: fastest at
    // its start, slowing all the way (the quintic join below takes the speed up to it smoothly from the creep);
    // the slow drift after it heads right/up, the way the exit ramp goes, so the path never turns back
    const s = 1 - Math.exp(-t / TAU);
    const lz = Math.log(P3.z) + (Math.log(W0.z) - Math.log(P3.z)) * s - 0.025 * t;
    return {x: P3.x + (W0.x - P3.x) * s + TOUR_PULL.driftX * t, y: P3.y + (W0.y - P3.y) * s + TOUR_PULL.driftY * t, z: Math.exp(lz), r: P3.r + (W0.r - P3.r) * s + 0.008 * t};
  };
  // v46: the outgoing arc gathers speed without a velocity/acceleration step at its onset.
  const ramp = (u: number) => Math.exp(u) - 1 - u - u * u / 2;
  const outR: Rig = (T) => {
    const c = pull(T);
    const u = Math.max(0, Math.min(OUT, T - (b - OUT)));
    const k = ramp(u / 0.5) / ramp(OUT / 0.5);
    return {...c, x: c.x + 1300 * k, y: c.y - 800 * k, r: c.r + 0.05 * k};
  };
  // Match position and velocity when the last close visit becomes the pullback.
  const joinA = t3 - TOUR_PULL.joinBefore, joinB = t3 + TOUR_PULL.joinAfter, joinD = joinB - joinA; // (v31) tuning.ts TOUR_PULL
  const vec = (c: Cam) => [c.x, c.y, Math.log(c.z), c.r];
  const tangent = (f: Rig, t: number) => {
    const p = vec(f(t - 0.0001)), q = vec(f(t + 0.0001));
    return q.map((v, i) => (v - p[i]) / 0.0002);
  };
  const acceleration = (f: Rig, t: number) => {
    const p = vec(f(t - 0.001)), q = vec(f(t)), r = vec(f(t + 0.001));
    return q.map((v, i) => (p[i] - 2*v + r[i]) / 0.000001);
  };
  const p0 = vec(visits(joinA)), p1 = vec(outR(joinB));
  const v0 = tangent(visits, joinA), v1 = tangent(outR, joinB);
  const acc0 = acceleration(visits, joinA), acc1 = acceleration(outR, joinB);
  const rig: Rig = (T) => {
    if (T <= joinA) return visits(T);
    if (T >= joinB) return outR(T);
    const u = (T - joinA) / joinD;
    // Quintic join matches position, velocity and acceleration on both ends.
    const v = p0.map((p, i) => {
      const dv = v0[i]*joinD, da = acc0[i]*joinD*joinD;
      const A = p1[i]-p-dv-da/2, B = v1[i]*joinD-dv-da, C = acc1[i]*joinD*joinD-da;
      return p + dv*u + da*u*u/2 + (10*A-4*B+C/2)*u**3
        + (-15*A+7*B-C)*u**4 + (6*A-3*B+C/2)*u**5;
    });
    return {x:v[0], y:v[1], z:Math.exp(v[2]), r:v[3]};
  };
  // (v15, user) the photo flash, the jump and the face change together on the beat: the face changes under the
  // flash, the jump starts with it (the flash used to come 0.3 s before the jump and read as early)
  const jumpAt = o.jumpAt ?? t3 + 0.3;
  // (v59, user) the crowd's penlights move as in the credits (0:14-0:18): the same beat-locked swing and, on the one
  // B小町！フッフー！ here (o.callAt, the B小町 on its bar line), the same raise at the same point of the swing
  const raise = o.callAt !== undefined ? callRaise([{t: o.callAt}, {t: o.callAt + 2.5 * BEAT}]) : undefined;
  const lift = raise ? (T: number, id: number, ph: number) => raise(T, id, ph) * CROWD_CALLS.creditsScale : undefined;
  const shots: Shot[] = [camShot(a, b, 'spotlight tour [path]', rig, (ctx, T) => beamScene(ctx, T, a - 2, {lift, amp: lift ? CROWD_CALLS.creditsSway : undefined, rise: clamp((T - t3) / 0.8), thin: false, chase: true, sweep: 0.16, hops: [jumpAt], face: (_m, T2) => (T2 < jumpAt + 0.02 ? 'full_wink' : 'full_laugh')}))];
  const flashT = jumpAt;
  // the burst into Pre 2 builds earlier and clears later (user: too fast)
  shots.push(starBurst(b, C('popy').main, 0.5, 0.42, true)); // Pre 2 opens on POPY; (v35) full cover
  return {shots, fx: [rigBlur(rig, a, b), flashAt(flashT, 0.25, 0.6)]};
};

/** Interlude: spotlights, steady push in (measured 11 %/s), penlights waving hard, red circle wipe out. */
/** Interlude, part 1 (user: not a camera move again - a performance): a light show. The stage is dark, the
 *  three beams snap on one by one on the beat (each member lights up), then the beams swing across each other
 *  on a four-beat figure and each crossing changes the faces (sparkle pop), confetti on the downbeat, a strobe
 *  run at the end into the red circle wipe. The camera only pushes in slowly (never still). */
export const tBeamPush = (a: number, b: number): Part => {
  const lamps = [a + 2 * BEAT, a + 3 * BEAT, a + 4 * BEAT];
  const base = glide(a, b, {x: 960, y: 500, z: 1.15, r: -0.02}, {dir: [0, 1], px: 18, rot: 0.012, zoom: 0.05, inK: 14, outK: 14, tauIn: 0.22, tauOut: 0.2});
  // (v42, user: push in harder and further before the cut at 2:29) an exponential push on top of the glide,
  // starting from zero speed: tuning.ts LIGHTSHOW_OUT
  const LO = LIGHTSHOW_OUT;
  const ex = (s: number) => (s > 0 ? Math.exp(s / LO.tau) - 1 - s / LO.tau : 0);
  const pushK = Math.log(LO.zoom) / ex(LO.lead);
  const rig: Rig = (T) => {
    const c = base(T);
    return {...c, z: c.z * Math.exp(pushK * ex(T - (b - LO.lead)))};
  };
  const FACES: Kind[] = ['full_wink', 'full_laugh', 'full_smug', 'full_kiss'];
  const jumpAt = a + 6 * BEAT;
  const face = (m: Member, T: number): Kind => (T < jumpAt + 0.17 ? 'full' : FACES[SPOT_M.indexOf(m) % 4]);
  const confettiAt = a + 6 * BEAT;
  const shots: Shot[] = [
    camShot(a, b, 'spotlight show', rig, (ctx, T) => {
      beamScene(ctx, T, a - 2, {thin: false, lampOn: lamps, sweep: (T2) => lerp(0.06, 0.3, easeInOut(prog(T2, jumpAt - 0.4, jumpAt + 0.8))), face, hops: [jumpAt]});
      if (T > confettiAt) paper(ctx, T, confettiAt, 64, 80, [RED, YEL, PINK, '#ffffff', LAV], 320);
    }, (ctx, T) => {
      // the darkness before the lamps; (v17) it opens from the black of the screen switching off (the portraits
      // end that way) to the dim stage, with the dot of the screen fading out in the middle
      const d = 1 - clamp((T - lamps[0] + 0.1) / 0.5);
      const dk = Math.max(0.6 * d, 0.95 * (1 - easeOutCubic(clamp((T - a) / 0.4))));
      if (dk > 0) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = dk;
        ctx.fillStyle = '#1a1024';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      const dot = 1 - clamp((T - a) / 0.3);
      if (dot > 0) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'screen';
        glow(ctx, W / 2, H / 2, 60 + 40 * (1 - dot), '#fff0ff', 0.7 * dot);
        ctx.restore();
      }
      // each lamp flares as it snaps on
      lamps.forEach((t0, i) => {
        const k = 1 - clamp((T - t0) / 0.5);
        if (T >= t0 && k > 0) lensFlare(ctx, SPOT_X[i], 40, 0.5 + 0.8 * k, ['#e2d2ff', '#ffd0ec', '#fff1c9'][i]);
      });
    }),
    {
      a: b - 0.3,
      b,
      z: 10,
      label: 'red circle wipe',
      draw: (ctx, T) => {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = RED;
        ctx.beginPath();
        ctx.arc(1500, 600, 1500 * easeInCubic(prog(T, b - 0.3, b)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    },
  ];
  // (v15, user: no strobe here) the four flashes before the red wipe are gone
  return {shots, fx: [rigBlur(rig, a, b), ...lamps.map((t) => flashAt(t, 0.1, 0.35)), flashAt(jumpAt + 0.17, 0.3, 0.3)]};
};

/** A transition (user): huge hearts very close to the lens rise from the bottom and cover the screen at the
 *  cut, then clear upward on the other side. (v15, user: opaque, colourful hearts, not a pile of see-through
 *  blobs) A few big solid hearts, each its own colour with a white rim and a gloss, sharp; they meet edge to
 *  edge at the cut (laid out to cover the frame) and rise at different speeds (the bigger, nearer ones faster),
 *  so before and after the cut they are scattered. */
export const riseCover = (at: number, dur = 1.1): Part => ({
  shots: [
    {
      a: at - dur * 0.55,
      b: at + dur * 0.45,
      z: 11,
      label: 'rising cover',
      draw: (ctx, T) => {
        const u = (T - (at - dur * 0.55)) / dur; // 0..1, cut at 0.55
        // [x, y at the cut, size, colour, speed]; back to front
        const H7: [number, number, number, string, number][] = [
          [1930, 250, 700, '#ff9ad0', 0.8],
          [-20, 238, 680, '#ff9a3d', 0.85],
          [640, 392, 900, LAV, 0.95],
          [1340, 450, 940, RED, 1.0],
          [1660, 928, 1000, '#5fd6e0', 1.12],
          [280, 937, 980, PINK, 1.18],
          [980, 1075, 1150, YEL, 1.3],
        ];
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        H7.forEach(([x, y0, sz, col, sp], i) => {
          const y = y0 + (0.55 - u) * sp * 3000;
          if (y - sz * 0.85 > H + 40 || y + sz * 0.4 < -40) return;
          const rot = (i % 2 ? 1 : -1) * (0.08 + 0.12 * (0.55 - u));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot);
          heartPath(ctx, 0, 0, sz);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.lineWidth = 18;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          // gloss on the left lobe
          ctx.beginPath();
          ctx.ellipse(-sz * 0.33, -sz * 0.52, sz * 0.13, sz * 0.07, -0.6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fill();
          ctx.restore();
        });
        ctx.restore();
      },
    },
  ],
  fx: [],
});

// ---------------------------------------------------------------- portrait shots (spoken lines, interlude)

// After reference 1 (19.5-29 s): a big close portrait on one side; the member's name in giant chunky
// letters on the other (solid colour, white hatching over the lower part, an outlined echo sliding
// behind); the line in a colour capsule laid across the name; diagonal stripe bands, outline triangles
// and rings drifting; blade-wipe transitions in the next member's colour.

type Lay = {m: Member; x: number; y: number; f: number; k: Kind}[];
const layFor = (who: Member[], side: 'right' | 'left'): {lay: Lay; textX: number} => {
  // (MEW's bust picture is cut at the top: her face must sit at least 1.16 face heights below the frame top)
  if (who.length === 1) return {lay: [{m: who[0], x: side === 'right' ? 1190 : 560, y: 440, f: 360, k: 'main'}], textX: side === 'right' ? 470 : 1330};
  if (who.length === 2)
    return {
      lay: [
        {m: who[0], x: 760, y: 480, f: 270, k: who[0] === 'mew' ? 'full' : 'main'},
        {m: who[1], x: 1300, y: 490, f: 270, k: who[1] === 'mew' ? 'full' : 'main'},
      ],
      textX: 380,
    };
  return {
    lay: [
      {m: 'mew', x: 470, y: 470, f: 235, k: 'full'},
      {m: 'halo', x: 1450, y: 470, f: 235, k: 'full'},
      {m: 'popy', x: 960, y: 500, f: 245, k: 'full'},
    ],
    textX: 960,
  };
};

/** Outline triangles and rings drifting and turning (reference 1 background furniture). */
const shapesBg = (ctx: Ctx, T: number, a: number, col: string, seed: number) => {
  ctx.save();
  ctx.lineWidth = 7;
  for (let i = 0; i < 12; i++) {
    const x = rnd(seed, i) * (W + 400) - 200 + (T - a) * (rnd(seed + 1, i) - 0.5) * 80;
    const y = rnd(seed + 2, i) * (H + 300) - 150 - (T - a) * (20 + rnd(seed + 3, i) * 40);
    const r = 40 + rnd(seed + 4, i) * 110;
    ctx.strokeStyle = hexA(i % 3 ? col : '#ffffff', 0.35);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((T - a) * (rnd(seed + 5, i) - 0.5) * 1.2 + i);
    ctx.beginPath();
    if (i % 2) ctx.arc(0, 0, r, 0, Math.PI * 2);
    else {
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.87, r * 0.5);
      ctx.lineTo(-r * 0.87, r * 0.5);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
};

/** Giant chunky name: letters slam in one by one, solid member colour, white hatching over the lower
 *  part (clipped to the letters), then a slow drift. Scene coordinates; (x, y) = centre of the word. */
const giantName = (ctx: Ctx, T: number, at: number, word: string, x: number, y: number, size: number, col: string, rot = 0) => {
  const chars = Array.from(word);
  const adv = size * 0.74;
  const {c, g} = layer('giantName');
  g.setTransform(ctx.getTransform());
  g.translate(x + (T - at) * 10, y);
  g.rotate(rot);
  let any = false;
  chars.forEach((ch, i) => {
    const k = clamp((T - (at + i * 0.07)) / 0.26);
    if (k <= 0) return;
    any = true;
    const e = easeOutBack(k, 1.8);
    const sc = lerp(2.4, 1, e);
    drawGlyph(g, ch, {fill: col}, size, (i - (chars.length - 1) / 2) * adv, 0, (1 - k) * (i % 2 ? 0.5 : -0.5), sc, clamp(k * 4));
  });
  if (!any) return;
  // white hatching over the lower half of the letters
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = hexA('#ffffff', 0.55);
  for (let sx = -adv * chars.length; sx < adv * chars.length; sx += 34) {
    g.beginPath();
    g.moveTo(sx, size * 0.02);
    g.lineTo(sx + 14, size * 0.02);
    g.lineTo(sx + 14 + size * 0.5, size * 0.52);
    g.lineTo(sx + size * 0.5, size * 0.52);
    g.fill();
  }
  g.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c, 0, 0);
  ctx.restore();
};

/** Outlined echo of a word, scrolling (behind the solid name). */
const echoWord = (ctx: Ctx, T: number, a: number, word: string, y: number, size: number, col: string, dir: number) => {
  ctx.save();
  ctx.font = `900 ${size}px ${FONT}, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = hexA(col, 0.45);
  const txt = `${word} ${word} ${word} ${word} ${word} ${word}`;
  const w = ctx.measureText(`${word} `).width;
  const off = ((((T - a) * 90 * dir) % w) + w) % w;
  ctx.strokeText(txt, -w * 2 + off, y);
  ctx.restore();
};

/** The line in a colour capsule: the capsule stretches open, the glyphs pop in a few frames apart. */
const lineCapsule = (ctx: Ctx, T: number, at: number, gs: Glyph[], x: number, y: number, maxW: number, col: [string, string], rot = 0) => {
  const k = clamp((T - at) / 0.14);
  if (k <= 0) return;
  const n = gs.length;
  const size = Math.min(66, (maxW - 60) / Math.max(1, n * 0.98));
  const ps = layoutLine(gs, {size, align: 0.5});
  const x0 = Math.min(...ps.map((p) => p.x - p.size / 2));
  const x1 = Math.max(...ps.map((p) => p.x + p.size / 2));
  const pad = size * 0.55;
  const cx = (x0 + x1) / 2;
  const w = x1 - x0 + pad * 2;
  const h = size * 1.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // the whole box (and so the whole line) is on screen from its first frame (user): shift it in if needed
  const t = ctx.getTransform();
  const pts = [[cx - w / 2 - 8, -h / 2 - 8], [cx + w / 2 + 8, -h / 2 - 8], [cx + w / 2 + 8, h / 2 + 8], [cx - w / 2 - 8, h / 2 + 8]].map(([px, py]) => [t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f]);
  const mg = 36;
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const sx = minX < mg ? mg - minX : maxX > W - mg ? W - mg - maxX : 0;
  const sy = minY < mg ? mg - minY : maxY > H - mg ? H - mg - maxY : 0;
  if (sx || sy) ctx.setTransform(t.a, t.b, t.c, t.d, t.e + sx, t.f + sy);
  // the box pops in at full size, the glyphs fall into it a few frames apart, centred on it
  const s0 = lerp(0.85, 1, easeOutBack(k, 2));
  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(s0, s0);
  ctx.globalAlpha *= clamp(k * 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 16, size);
  ctx.fill();
  ctx.fillStyle = col[1];
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, size);
  ctx.fill();
  ctx.restore();
  drawPlaced(ctx, ps, T, {fill: '#ffffff', stroke: col[1], sw: 0.06}, cascade(at + 0.06, 0.025));
  ctx.restore();
};

/** Blade wipe at a cut (reference 1 at 28.5 s): six blades in the next colour sweep round from the centre,
 *  cover the frame at the cut and sweep on out of it; white stripes and a dotted disc ride on them. */
const bladeWipe = (at: number, col: string, dur = 0.5): Shot => ({
  a: at - dur / 2,
  b: at + dur / 2,
  z: 10,
  label: 'blade wipe',
  draw: (ctx, T) => {
    const u = (T - (at - dur / 2)) / dur; // 0..1, 0.5 = cut
    const cover = u < 0.5 ? easeInCubic(u * 2) : 1 - easeOutCubic((u - 0.5) * 2);
    if (cover <= 0.001) return;
    const spin = u * 2.4;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a0 = spin + (i * Math.PI) / 3;
      ctx.moveTo(960, 540);
      ctx.arc(960, 540, 1400, a0, a0 + (Math.PI / 3) * cover);
      ctx.closePath();
    }
    ctx.fillStyle = col;
    ctx.fill();
    ctx.clip();
    stripes(ctx, hexA('#ffffff', 0.35), 60, 18, -0.7, T * 300);
    ctx.fillStyle = hexA('#ffffff', 0.85);
    ctx.beginPath();
    ctx.arc(960, 540, 190 * cover, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
});

/** A screen switching off over the last `dur` seconds before `at` (v17): the finished frame folds vertically into
 *  a bright horizontal line (getting brighter as it thins), the line shrinks into a dot, the dot goes out. */
const screenOff = (ctx: Ctx, T: number, at: number, dur = 0.42) => {
  const u = prog(T, at - dur, at);
  if (u <= 0) return;
  const {c, g} = layer('screenOff');
  g.drawImage(ctx.canvas, 0, 0);
  const p1 = clamp(u / 0.6);
  const p2 = clamp((u - 0.6) / 0.28);
  const p3 = clamp((u - 0.88) / 0.12);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0c0712';
  ctx.fillRect(0, 0, W, H);
  const sy = Math.max(0.004, 1 - easeInCubic(p1) * 0.996);
  const sx = Math.max(0.01, 1 - easeInCubic(p2) * 0.99);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(sx, sy);
  ctx.translate(-W / 2, -H / 2);
  ctx.globalAlpha = 1 - p3;
  ctx.drawImage(c, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `rgba(255,250,255,${0.9 * p1})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // the glow around the line / dot
  if (p1 > 0.5) {
    const k = (p1 - 0.5) * 2 * (1 - p3);
    ctx.globalCompositeOperation = 'screen';
    const r = lerp(900, 60, p2);
    const gg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
    gg.addColorStop(0, `rgba(255,240,255,${0.9 * k})`);
    gg.addColorStop(1, 'rgba(255,240,255,0)');
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1, lerp(0.08, 1, p2));
    ctx.translate(-W / 2, -H / 2);
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  ctx.restore();
};

export const tPortraits9 = (list: {a: number; b: number; who: Member[]; gs?: Glyph[]; phrases?: number[]; word: string}[], o: {lyrics?: boolean; end?: 'push' | 'screenOff' | 'slide'} = {}): Part => {
  // all portraits travel the same way: the picture enters from the left moving right, keeps sliding right
  // slowly while the line is sung, and leaves to the right accelerating (clockwise turn with it); the next
  // portrait continues that motion, so every cut carries the movement on
  const shots: Shot[] = [];
  const rigs: {a: number; b: number; rig: Rig}[] = [];
  list.forEach((it, i) => {
    const tilt = i % 2 ? 0.035 : -0.035;
    // a portrait on the right travels right, one on the left travels left (user: MEW from right to left)
    const dirX = i % 2 ? -1 : 1;
    // (v15) the last portrait used to drift into a white flash: now it pushes and turns into the cut ('push':
    // the spoken lines, where the オレモー！ bubbles burst over it - tCallWall9)
    // (v17, user: the lights-down was reused from the interlude and did not fit) the interlude's last portrait
    // ends as a video on the stage screen switching off ('screenOff'): the picture folds into a bright line, the
    // line into a dot, the dot goes out - and the dark stage of the light show is there
    const lastP = i + 1 === list.length;
    const endFx = lastP ? o.end ?? 'push' : undefined;
    const g0 = glide(it.a, it.b, {x: W / 2, y: H / 2, z: 1.04, r: tilt}, {dir: [dirX, 0.05], px: 70, rot: 0.012 * dirX, zoom: 0.015, inK: 12, outK: i + 1 < list.length ? 12 : 8});
    const rig = endFx === 'push' ? intoCut(g0, it.b, {dur: 0.45, tau: 0.13, zoom: 1.6, rot: 0.15 * dirX}) : g0;
    const side = i % 2 ? 'left' : 'right';
    const {lay, textX} = layFor(it.who, side);
    const m = it.who[0];
    const col = C(m).main;
    const solo = it.who.length === 1;
    shots.push(
      camShot(
        it.a,
        it.b,
        `portrait ${it.who.join('+')}`,
        rig,
        (ctx, T) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-W, -H, W * 3, H * 3);
          ctx.fillStyle = hexA(C(m).light, 0.6);
          ctx.fillRect(-W, -H, W * 3, H * 3);
          // diagonal bands sliding, rays turning behind the portrait, shapes drifting
          stripes(ctx, hexA(col, 0.16), 520, 190, -0.75, (T - it.a) * 120);
          stripes(ctx, hexA('#ffffff', 0.5), 64, 16, -0.75, (T - it.a) * 120);
          ctx.save();
          ctx.globalAlpha = 0.35;
          sunburst(ctx, solo ? lay[0].x : 960, 420, 18, '#ffffff', (T - it.a) * 0.2);
          ctx.restore();
          shapesBg(ctx, T, it.a, col, 80 + i);
          if (solo) {
            const name = it.word;
            const nsz = Math.min(380, 880 / (Array.from(name).length * 0.74));
            echoWord(ctx, T, it.a, name, 760, nsz * 0.8, col, side === 'right' ? 1 : -1);
            giantName(ctx, T, it.a + 0.08, name, textX, 330, nsz, col, -0.04);
          } else {
            // several singers: their names as outlined echoes behind (the solid names go above their heads, below)
            it.who.forEach((mm, j) => echoWord(ctx, T, it.a, NAMES[mm], 300 + j * 300, 230, C(mm).main, j % 2 ? -1 : 1));
          }
          sparkles(ctx, T, 90 + i, 10, ['#ffffff', YEL, col], {x: 0, y: 0, w: W, h: H}, [14, 34]);
          lay.forEach((p) => figAt(ctx, p.m, p.m === 'mew' ? 'full' : p.k, p.x + Math.sin((T - it.a) * 0.9) * 6, p.y, p.f));
          // several singers: each one's name stands above her head (as in the credits)
          if (!solo) lay.forEach((p, j) => giantName(ctx, T, it.a + 0.1 + j * 0.12, NAMES[p.m], p.x, p.y - p.f * 1.18 - (p.m === 'halo' ? 55 : 0), 128, C(p.m).main, j % 2 ? 0.04 : -0.04)); // (HALO's hat stands tall)
          // the line in its capsule (scene space: it moves with the camera)
          if (it.gs && o.lyrics !== false) {
            const parts = splitPhrases(it.gs);
            parts.forEach((ps, j) => {
              const at = j === 0 ? it.a + 0.3 : Math.max(it.a + 0.3, ps[0].t - 0.15);
              if (solo) lineCapsule(ctx, T, at, ps, textX + (j ? 120 : -40), 560 + j * 120, 900, MC[m], -0.04);
              else lineCapsule(ctx, T, at, ps, 960 + (parts.length > 1 ? (j ? 170 : -170) : 0), 900 + j * 105 - (parts.length > 1 ? 50 : 0), 1500, MC[it.who[j % it.who.length]] ?? [PINK, '#e0337a'], -0.02);
            });
          }
        },
        endFx === 'screenOff' ? (ctx, T) => screenOff(ctx, T, it.b) : undefined,
      ),
    );
    if (i + 1 < list.length) shots.push(bladeWipe(list[i + 1].a, C(list[i + 1].who[0]).main));
    rigs.push({a: it.a, b: it.b, rig});
  });
  return {shots, fx: blurOf(rigs)};
};

/** Split a run at its full-width spaces (phrase boundaries). */
const splitPhrases = (gs: Glyph[]): Glyph[][] => {
  const out: Glyph[][] = [[]];
  gs.forEach((g) => {
    if (g.ch === '　' || g.ch === ' ') out.push([]);
    else out[out.length - 1].push(g);
  });
  return out.filter((l) => l.length);
};

/** Breaks a run into two capsule lines after the given leading text (the second line comes in when sung). */
const breakAfter = (gs: Glyph[], head?: string): Glyph[] => {
  if (!head) return gs;
  let n = 0;
  let acc = '';
  while (n < gs.length && acc.length < head.length) acc += gs[n++].ch;
  if (acc !== head || n >= gs.length) return gs;
  return [...gs.slice(0, n), {...gs[n], ch: '　'}, ...gs.slice(n)];
};

export const tSpoken9 = (segs: Seg[], end: number, a0: number, breaks: (string | undefined)[] = []): Part =>
  tPortraits9(
    segs.map((sg, i) => {
      const who = whoOf(sg);
      return {
        a: i === 0 ? a0 : sg.start - lead,
        b: i + 1 < segs.length ? segs[i + 1].start - lead : end,
        who,
        gs: breakAfter(glyphs(sg.toks), breaks[i]),
        word: NAMES[who[0]],
      };
    }),
    // (v26, user: HALO's portrait must not push in at its end) it keeps sliding into the オレモー！ wall
    {end: 'slide'},
  );

// ---------------------------------------------------------------- call wall (オレモー！)

/** (v17, user: the cut from the last spoken line needed its own transition) the crowd's オレモー！ bubbles burst up
 *  over the last portrait before the cut, row after row from the bottom (the audience shouting back), already in
 *  their places in the wall; at the cut the wall is full and the three are behind it. `preIn`: how long before
 *  the cut the first bubble pops. */
export const tCallWall9 = (a: number, b: number, text: string, o: {preIn?: number} = {}): Part => {
  // the reference camera here: pulls back (x0.55) while turning 8 deg; we keep 60 % of the pull
  // the reference here pulls back hard while turning clockwise; the picture keeps travelling right
  // (v26, user: pull back further first, then push in closer, with more turn) zoom -0.25 -> -0.45, turn 0.03 -> 0.05
  const pull = glide(a, b, {x: W / 2, y: H / 2, z: 1.2, r: -0.04}, {dir: [1, 0.1], px: 60, rot: 0.05, zoom: -0.45, inK: 8, outK: 1});
  // (user) right before the cut: a hard push in with a strong turn (v26: x2.0 -> x3.2, turn 0.35 -> 0.6)
  const rig: Rig = (T) => {
    const c = pull(T);
    const u = T - (b - 0.38);
    const g = u > 0 ? (Math.exp(u / 0.1) - 1) / (Math.exp(0.38 / 0.1) - 1) : 0;
    return {...c, z: c.z * Math.exp(Math.log(3.2) * g), r: c.r + 0.6 * g};
  };
  const cols = [RED, PINK, YEL, '#9a6cf5'];
  const pre = o.preIn ?? 0;
  const popAt = (i: number, r: number) => (pre > 0 ? a - pre + pre * 0.8 * ((6 - r) / 7) + rnd(281, (r + 1) * 9 + i + 1) * 0.06 : a + (i + r) * 0.02);
  const bubbles = (ctx: Ctx, T: number) => {
    const lt = T - a;
    for (let r = -1; r < 7; r++) {
      const dir = (r + 2) % 2 ? 1 : -1;
      const y = 80 + r * 170;
      for (let i = -1; i < 7; i++) {
        const x = (((i * 360 + dir * lt * 520 + r * 120) % 2880) + 2880) % 2880 - 400;
        const t0 = popAt(i, r);
        const kk = easeOutBack(prog(T, t0, t0 + (pre > 0 ? 0.14 : 0.2)), 2.2);
        if (kk <= 0) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(kk, kk);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#3a3542';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.rect(-160, -58, 320, 116);
        ctx.moveTo(-60, 58);
        ctx.lineTo(-90, 100);
        ctx.lineTo(-20, 58);
        ctx.fill();
        ctx.stroke();
        label(ctx, text, 0, 0, 70, BUB(cols[(i + r + 8) % 4], cols[(i + r + 8) % 4], hexA('#3a1020', 0.35)), 0.5, 0);
        ctx.restore();
      }
    }
  };
  const shots: Shot[] = [
    camShot(a, b, 'call wall', rig, (ctx, T) => {
      bg(ctx, T, 70);
      bubbles(ctx, T);
      // the three in front of the wall; after a bubble burst they pop up out of it one by one (spring, from the feet)
      ([['mew', 590, 360, 110, 0.04], ['popy', 960, 390, 116, 0.0], ['halo', 1330, 360, 110, 0.08]] as [Member, number, number, number, number][]).forEach(([m, x, y, f, d]) => {
        const k = pre > 0 ? easeOutBack(clamp((T - a - d) / 0.22), 1.8) : 1;
        if (k <= 0) return;
        const feet = y + f * 7.5;
        ctx.save();
        ctx.translate(x, feet);
        ctx.scale(k, k);
        ctx.translate(-x, -feet);
        figAt(ctx, m, 'full_laugh', x, y, f);
        ctx.restore();
      });
      penCrowd(ctx, T, {seed: 7});
    }),
  ];
  if (pre > 0)
    shots.push({
      a: a - pre,
      b: a,
      z: 9,
      label: 'call wall bubbles in',
      draw: (ctx, T) => inCam(ctx, rig(a), () => bubbles(ctx, T)),
    });
  return {shots, fx: [rigBlur(rig, a, b), ...(pre > 0 ? [] : [flashAt(a, 0.2, 0.5)])]};
};

// ---------------------------------------------------------------- Pre: singers stacking up

/** A hanging vertical tag (white, thick member-colour border) around a vertical layout. */
const tagBox = (ctx: Ctx, ps: Placed[], col: string, k: number) => {
  if (!ps.length || k <= 0) return;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of ps) {
    x0 = Math.min(x0, p.x - p.size * 0.62);
    x1 = Math.max(x1, p.x + p.size * 0.62);
    y0 = Math.min(y0, p.y - p.size * 0.66);
    y1 = Math.max(y1, p.y + p.size * 0.66);
  }
  const h = (y1 - y0) * easeOutCubic(k);
  ctx.save();
  ctx.shadowColor = 'rgba(60,20,50,0.22)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(x0, y0, x1 - x0, h, 18);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = col;
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.restore();
};

export const tPreStack = (segs: Seg[], a0: number, end: number, o: {turn?: boolean} = {}): Part => {
  const starts = segs.map((sg, i) => (i === 0 ? a0 : sg.start - lead));
  const sides = segs.map((_, i) => (i % 2 === 0 ? 'left' : 'right'));
  // camera (reference: each line slowly pulls back; no sideways travel): one continuous camera through the
  // four lines (no jump at a line change); each line arrives with a turn in the direction its singer slides in
  // (from the left: clockwise; from the right: counter-clockwise), keeps pulling back and turning slowly, and
  // accelerates out. The previous singer is pushed back to the far side.
  const preRig: Rig = glideSeq(
    [...starts, end],
    {x: W / 2, y: H / 2, z: 1.06, r: 0}, // (at the start of the first line; the pull back accumulates gently)
    starts.map((_, i) => ({dir: [0, 0] as [number, number], px: 0, rot: sides[i] === 'left' ? 0.024 : -0.024, zoom: -0.013, inK: 12, outK: i + 1 < starts.length ? 9 : 6})),
  );
  const sizeK = starts.map((s) => preRig(starts[0] + 0.6).z / preRig(s + 0.6).z);
  // one layer per line: portrait on one side, diamond frames, the lyric (tag, or huge letters for a keyword line)
  const drawLayer = (g: CanvasRenderingContext2D, i: number, T: number) => {
    const sg = segs[i];
    const m = whoOf(sg)[0];
    const lt = T - starts[i];
    const left = sides[i] === 'left';
    const cx = left ? 760 : 1160;
    // (user, v15) every singer as big as the first one: the camera's gentle pull back adds up over the four
    // lines (z 1.03 -> 0.86), so each layer is scaled back by that line's share (constant per layer: no jump)
    const pull = lerp(1.22, 1.0, easeOutCubic(clamp(lt / 1.6))) * sizeK[i];
    g.save();
    g.translate(cx, 540);
    g.scale(pull, pull);
    g.translate(-cx, -540);
    const slide = easeOutCubic(prog(lt, 0.1, 0.5));
    [
      [1000, MC[m][0], 36],
      [780, C(m).light, 20],
    ].forEach(([s, c, w], j) => {
      g.save();
      g.translate(cx + (1 - slide) * (j ? -1300 : 1300), 540);
      g.rotate(Math.PI / 4 + (j ? -1 : 1) * lt * 0.2);
      g.strokeStyle = c as string;
      g.lineWidth = w as number;
      g.strokeRect(-(s as number) / 2, -(s as number) / 2, s as number, s as number);
      g.restore();
    });
    figAt(g, m, m === 'mew' ? 'full' : 'main', cx, 450, 330);
    g.restore();
  };
  const lyricOf = (ctx: Ctx, i: number, T: number) => {
    const sg = segs[i];
    const m = whoOf(sg)[0];
    const gs = noSpace(glyphs(sg.toks));
    const left = sides[i] === 'left';
    const at = starts[i] + 0.12;
    if (gs.length <= 4) {
      // keyword line: huge letters around the singer, diagonal
      // (v16, user: 近い将来 overlapped) the steps were shorter than the letters (150-170 x 190 px for 300 px
      // letters): now 245 px letters on 120-130 x 240 px steps (each letter clears the one above it), kept inside the frame
      // (v59, user: the letters' corners touched) a little smaller and a little further apart: tuning.ts PRE_KEYWORD
      const n = gs.length;
      const K = PRE_KEYWORD;
      const sz = K.size;
      const dy = Math.min(K.stepY, K.span / Math.max(1, n - 1));
      const ps: Placed[] = gs.map((g2, j) => ({ch: g2.ch, t: g2.t, x: (left ? 1300 : 300) + j * K.stepX, y: 200 + j * dy, size: sz, rot: left ? -0.18 : 0.18, i: j}));
      drawFancy(ctx, ps, T, BUB(MC[m][0], MC[m][1], hexA(MC[m][1], 0.45)), cascade(at, 0.07), {sparkle: ['#ffffff', C(m).light]});
      return;
    }
    const ps = layoutVert(gs, {size: 96, x: left ? 1620 : 340, y: 190, per: 7, colGap: 120});
    const drop = (1 - easeOutBack(clamp((T - at + 0.1) / 0.3), 1.6)) * -260;
    ctx.save();
    ctx.translate(0, drop);
    ctx.rotate(left ? 0.03 : -0.03);
    tagBox(ctx, ps, MC[m][0], clamp((T - at + 0.12) / 0.15));
    drawPlaced(ctx, ps, T, {fill: MC[m][1], weight: 900}, cascade(at, 0.03));
    ctx.restore();
  };
  const curAt = (T: number) => {
    let c = 0;
    starts.forEach((s, i) => {
      if (T >= s) c = i;
    });
    return c;
  };
  const shot: Shot = {
    a: a0,
    b: end,
    label: `pre stack [chain ${segs.length}] [alt]`,
    cam: preRig,
    turn: o.turn,
    draw: (ctx, T) => {
      ctx.save();
      view(ctx, preRig(T));
      const c = curAt(T);
      const m = whoOf(segs[c])[0];
      const pm = whoOf(segs[Math.max(0, c - 1)])[0];
      const mix = c === 0 ? 1 : clamp((T - starts[c]) / 0.3);
      // shared background: tiles, stripes in the singer's colour (cross-fading)
      bg(ctx, T, 80, C(m).main, 0.05, 30, 10);
      ctx.save();
      ctx.globalAlpha = 1 - mix;
      stripes(ctx, hexA(C(pm).light, 0.5), 260, 90, -0.75, T * 80);
      ctx.globalAlpha = mix;
      stripes(ctx, hexA(C(m).light, 0.5), 260, 90, -0.75, T * 80);
      ctx.restore();
      // the previous singer, pushed back (smaller, aside, soft, dimmer)
      if (c > 0) {
        const k = easeOutCubic(clamp((T - starts[c]) / 0.35));
        const left = sides[c] === 'left';
        const {c: lc, g} = layer('preBack');
        g.save();
        g.setTransform(ctx.getTransform());
        g.translate(left ? 1500 : 420, 560);
        const s = lerp(1, 0.6, k);
        g.rotate((left ? 0.22 : -0.22) * k); // pushed right -> turns clockwise, pushed left -> counter-clockwise
        g.scale(s, s);
        g.translate(-(left ? 1500 : 420) + lerp(0, left ? 700 : -700, k), -560);
        drawLayer(g, c - 1, T);
        g.restore();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawBlurred(ctx, lc, lerp(0, 7, k)); // (v15: was 12 px at 85 % opacity: see-through on the pale ground it read washed out)
        ctx.restore();
      }
      // the current singer arrives fast (rotation + slide), then settles
      const e = 1 - easeOutCubic(clamp((T - starts[c]) / 0.32));
      const left = sides[c] === 'left';
      ctx.save();
      ctx.translate(960, 540);
      ctx.rotate((left ? -0.4 : 0.4) * e);
      ctx.translate(-960 + (left ? -700 : 700) * e, -540);
      drawLayer(ctx, c, T);
      lyricOf(ctx, c, T);
      ctx.restore();
      ctx.restore();
    },
  };
  return {shots: [shot], fx: [rigBlur(preRig, a0, end)]};
};

// ---------------------------------------------------------------- 君も！ / 君と！: circle window on a pendulum

export const tPendulum = (words: Seg[], end: number, a0: number): Part => {
  const PIV = {x: 960, y: -1100};
  const RAD = 1640;
  const shots: Shot[] = words.map((w, i) => {
    const a = i === 0 ? a0 : w.start - 0.08;
    const b = i + 1 < words.length ? words[i + 1].start - 0.08 : end;
    const m = whoOf(w)[0];
    const dir = i % 2 ? -1 : 1;
    const gs = noSpace(glyphs(w.toks));
    // in: exponential (tau 0.075 s, most of the swing in the first 0.15 s); middle: still swinging the same
    // way, slowly (0.09 rad over the shot); out: exponential acceleration over the last 0.2 s
    const angle = (T: number) => {
      const t = Math.max(0, T - a);
      const u = T - (b - 0.2);
      const gout = u > 0 ? (Math.exp(u / 0.06) - 1) / (Math.exp(0.2 / 0.06) - 1) : 0;
      return -dir * 0.8 * Math.exp(-t / 0.075) + dir * 0.09 * (t / (b - a) - 0.5) + dir * 0.8 * gout;
    };
    // the window's motion as a camera (rotation about the pivot above), for the self-check
    const cam = (T: number): Cam => {
      const th = angle(T);
      const dx = PIV.x - 960;
      const dy = PIV.y - 540;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      return {x: PIV.x - (c * dx - sn * dy), y: PIV.y - (sn * dx + c * dy), z: 1, r: -th};
    };
    return {
      a,
      b,
      cam,
      label: `pendulum ${w.text} ${m} [alt]`,
      draw: (ctx, T) => {
        ctx.fillStyle = C(m).light;
        ctx.fillRect(0, 0, W, H);
        bg(ctx, T, 90 + i, C(m).main, 0.3);
        stripes(ctx, hexA(MC[m][0], 0.35), 220, 80, 0.7, (T - a) * 120);
        const th = angle(T);
        const wx = PIV.x + Math.sin(th) * RAD;
        const wy = PIV.y + Math.cos(th) * RAD;
        const {c, g} = layer('pend');
        g.save();
        g.translate(wx, wy);
        g.rotate(-th);
        g.beginPath();
        g.arc(0, 0, 440, 0, Math.PI * 2);
        g.save();
        g.clip();
        g.fillStyle = C(m).light;
        g.fillRect(-500, -500, 1000, 1000);
        faceShot(g, m, m === 'mew' ? 'full' : i % 2 ? 'wink' : 'main', 0, 30, 470);
        g.restore();
        g.lineWidth = 34;
        g.strokeStyle = MC[m][0];
        g.stroke();
        g.setLineDash([2, 30]);
        g.lineCap = 'round';
        g.lineWidth = 16;
        g.strokeStyle = '#ffffff';
        g.beginPath();
        g.arc(0, 0, 500, 0, Math.PI * 2);
        g.stroke();
        g.restore();
        // (user, v15: no blur going in or out) the window stays sharp at any swing speed
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(c, 0, 0);
        ctx.restore();
        const st = BIGTXT(m);
        const settle = a + 0.2;
        const ps: Placed[] = [
          ...gs.slice(0, 1).map((g2, j) => ({ch: g2.ch, t: g2.t, x: 380, y: 300, size: 400, rot: -0.12, i: j})),
          ...gs.slice(1).map((g2, j) => ({ch: g2.ch, t: g2.t, x: 1400 + j * 290, y: 800 - j * 30, size: 360, rot: 0.08, i: j + 1})),
        ];
        const out = prog(T, b - 0.15, b);
        ctx.save();
        ctx.globalAlpha = 1 - out;
        // the words drift with the swing too, a little
        ctx.translate(dir * (T - a) * 30, 0);
        drawPlaced(ctx, ps, T, st, {kind: 'cascade', at: settle, step: 0.06, dur: 0.16, drop: 0.2});
        ctx.restore();
      },
    };
  });
  return {shots, fx: []};
};

// ---------------------------------------------------------------- お待ちどうさま / 楽しまなきゃ: two-stage camera

export const tOmachi = (sg: Seg, a: number, b: number, split: number, o: {textAt?: number} = {}): Part => {
  const jump = a + Math.min(0.5, (b - a) * 0.42);
  // (v19, user: at 0:40 the words came too late and stayed too short) they can start before the jump
  const tx = o.textAt ?? jump;
  const rig = keysFlow([
    {t: a, x: 900, y: 580, z: 0.92, r: 0.1},
    {t: jump - 0.02, x: 955, y: 555, z: 1.02, r: 0.03, e: 'out'},
    {t: jump + 0.16, x: 960, y: 548, z: 2.1, r: -0.05, e: 'in2'}, // closer, the three higher (user)
    {t: b, x: 960, y: 552, z: 2.25, r: -0.06, e: 'out'},
  ]);
  const gs = noSpace(glyphs(sg.toks));
  return {
    shots: [
      camShot(a, b, `omachi ${sg.text}`, rig, (ctx, T) => {
        // warm sunburst (the colours of the big words), rings pulsing out from the three
        ctx.fillStyle = '#ffe7c2';
        ctx.fillRect(-W, -H, W * 3, H * 3);
        ctx.save();
        ctx.globalAlpha = 0.55;
        sunburst(ctx, 960, 470, 28, '#ffb36b', (T - a) * 0.35);
        ctx.restore();
        stripes(ctx, hexA('#ffffff', 0.25), 70, 20, 0.6, (T - a) * 200);
        for (let q = 0; q < 4; q++) {
          const u = (((T - a) * 0.9 + q / 4) % 1 + 1) % 1;
          ring(ctx, 960, 470, 80 + u * 1100, 26 * (1 - u), hexA(['#ffffff', YEL, PINK, '#ff8a3d'][q], 0.8 * (1 - u)));
        }
        riseShapes(ctx, T, a - 1, 'far', {seed: 11});
        // (v16, user) wink here and in the repeat
        figAt(ctx, 'halo', 'full_wink', 1110, 470, 62);
        figAt(ctx, 'mew', 'full_wink', 810, 470, 62);
        figAt(ctx, 'popy', 'full_wink', 960, 482, 65);
        riseShapes(ctx, T, a - 1, 'mid', {seed: 12});
        paper(ctx, T, a, 102, 60, [RED, YEL, PINK, '#ffffff']);
        penCrowd(ctx, T, {seed: 9, near: 3});
        riseShapes(ctx, T, a - 1, 'near', {seed: 13});
      }, (ctx, T) => {
        if (T < tx) return;
        const st = BUB('#ff8a3d', RED, hexA('#7a1020', 0.5));
        const r = layoutVert(gs.slice(0, split), {size: 240, x: 1660, y: 170});
        const l = layoutVert(gs.slice(split), {size: 240, x: 260, y: 290}).map((p) => ({...p, i: p.i + split}));
        drawFancy(ctx, [...r, ...l], T, st, cascade(tx + 0.04, 0.045), {sparkle: ['#ffffff', YEL]});
      }),
    ],
    fx: [rigBlur(rig, a, b), flashAt(jump, 0.15, 0.3)],
  };
};

// ---------------------------------------------------------------- A section: framed costume, stars rising, capsules

/** A-section page styles, one per member (v58: MEW's page in her own purple, was pink). */
export type CapStyle = 'yellow' | 'purple' | 'red';

/** Ribbon banner (replaces the black capsule): a colour sash with folded V tails, stitched edges and a
 *  highlight, unrolled from its left end on a spring (overshoots, settles), then the letters pop in with
 *  their own little spring; afterwards the sash keeps a soft wave. */
const ribbon = (ctx: Ctx, gs: Glyph[], T: number, x: number, y: number, size: number, at: number, col: [string, string], rot = 0) => {
  const ps = layoutLine(gs, {size, tracking: 0.02, align: 0.5});
  if (!ps.length) return;
  const lt = T - at;
  if (lt <= 0) return;
  const x0 = Math.min(...ps.map((p) => p.x - p.size * 0.5));
  const x1 = Math.max(...ps.map((p) => p.x + p.size * 0.5));
  const pad = size * 0.6;
  const w = x1 - x0 + pad * 2;
  const h = size * 1.45;
  const sp = 1 - Math.exp(-11 * lt) * Math.cos(17 * lt); // 0 -> 1 with an overshoot (quick: some lines are short)
  const wob = Math.exp(-5 * lt) * Math.sin(16 * lt) * 0.06 + Math.sin(lt * 2.4) * 0.012;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot + wob);
  // unroll from the left end
  const L = x0 - pad;
  ctx.save();
  ctx.translate(L, 0);
  ctx.scale(Math.max(0.001, sp), 1 + (1 - Math.min(1, sp)) * 0.3);
  ctx.translate(-L, 0);
  // tails (behind), darker
  ctx.fillStyle = col[1];
  [[L + size * 0.2, -1], [L + w - size * 0.2, 1]].forEach(([ex, d]) => {
    ctx.beginPath();
    ctx.moveTo(ex, -h * 0.32);
    ctx.lineTo(ex + d * size * 0.95, -h * 0.32 + size * 0.15);
    ctx.lineTo(ex + d * size * 0.62, h * 0.18 + size * 0.15);
    ctx.lineTo(ex + d * size * 0.95, h * 0.62 + size * 0.15);
    ctx.lineTo(ex, h * 0.62);
    ctx.closePath();
    ctx.fill();
  });
  ctx.shadowColor = 'rgba(60,10,40,0.28)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = col[0];
  ctx.beginPath();
  ctx.moveTo(L, -h / 2);
  ctx.quadraticCurveTo(L + w / 2, -h / 2 - size * 0.18, L + w, -h / 2);
  ctx.lineTo(L + w, h / 2);
  ctx.quadraticCurveTo(L + w / 2, h / 2 - size * 0.18, L, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(L, -h / 2 + size * 0.05, w, size * 0.16);
  ctx.setLineDash([size * 0.16, size * 0.12]);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.moveTo(L + size * 0.1, -h / 2 + size * 0.24);
  ctx.quadraticCurveTo(L + w / 2, -h / 2 + size * 0.06, L + w - size * 0.1, -h / 2 + size * 0.24);
  ctx.moveTo(L + size * 0.1, h / 2 - size * 0.18);
  ctx.quadraticCurveTo(L + w / 2, h / 2 - size * 0.36, L + w - size * 0.1, h / 2 - size * 0.18);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // letters: each pops on its own spring, left to right, slightly tilted alternately
  ps.forEach((p, j) => {
    const t = lt - 0.08 - j * 0.03;
    if (t <= 0) return;
    const k = 1 - Math.exp(-9 * t) * Math.cos(15 * t);
    drawGlyph(ctx, p.ch, {fill: '#ffffff', stroke: col[1], sw: 0.1}, p.size, p.x, p.y - size * 0.06 + Math.sin(T * 3 + j) * 2, (j % 2 ? 0.05 : -0.05) * (1 - Math.min(1, k)), Math.max(0, k), clamp(t / 0.05));
  });
  ctx.restore();
};

/** A big heart crossing the cut (covers the frame at the cut, flies on out).
 *  (v16, user: the cut over too slow, the next line late) it no longer slows to a stop on the cut: it comes in
 *  easing a little and leaves at full speed (0.17 s in, 0.15 s out, was 0.2 / 0.26 with a stop at the cut),
 *  so the next page and its line are clear about 0.1 s sooner. */
const heartWipe = (at: number, col: string, dir = -1, pre = 0.17, post = 0.15): Shot => ({
  a: at - pre,
  b: at + post,
  z: 9,
  label: 'heart wipe',
  draw: (ctx, T) => {
    const u = clamp((T - (at - pre)) / (pre + post));
    // position: centre crosses the frame centre exactly at the cut
    const uc = pre / (pre + post);
    const v = u < uc ? -Math.pow(1 - u / uc, 1.5) : (u - uc) / (1 - uc);
    const x = 960 - dir * 3100 * v;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(x, 0);
    ctx.rotate(-dir * 0.25 * v);
    heartPath(ctx, 0, 980, 1700);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.clip();
    stripes(ctx, hexA('#ffffff', 0.3), 70, 20, 0.8, T * 300);
    ctx.restore();
  },
});

const splitLine = (gs: Glyph[], at?: number): Glyph[][] => {
  const sp = gs.findIndex((g) => g.ch === '　');
  if (sp > 0) return [gs.slice(0, sp), gs.slice(sp + 1)];
  if (at === -1 || at === undefined && gs.length <= 7) return [gs];
  const h = at ?? Math.ceil(gs.length / 2);
  return [gs.slice(0, h), gs.slice(h)];
};

let checkerTile: HTMLCanvasElement | null = null;
/** Red and white squares of 110 px as a repeating pattern (two by two per tile). */
const checker = (ctx: Ctx): CanvasPattern => {
  if (!checkerTile) {
    checkerTile = document.createElement('canvas');
    checkerTile.width = 220;
    checkerTile.height = 220;
    const g = checkerTile.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 220, 220);
    g.fillStyle = RED;
    g.fillRect(110, 0, 110, 110);
    g.fillRect(0, 110, 110, 110);
  }
  return ctx.createPattern(checkerTile, 'repeat')!;
};

/** One A-section page's ground (tiles, the style's pattern, sparkles, the far crowd); page i sets the seeds.
 *  Shared by the capsule pages and (v57) the three CHU shots. */
const capsuleGround = (ctx: Ctx, T: number, st: CapStyle, i: number, o: {pens?: boolean; sparkles?: boolean} = {}) => {
  const tint = capTint(st);
  bg(ctx, T, 110 + i, tint, 0.08, 20, -30);
  if (st === 'yellow') {
    beam(ctx, 1500, -100, 160, 900, hexA(YEL, 0.85), Math.sin(T * 0.9) * 0.08);
    beam(ctx, 1820, -100, 120, 620, hexA('#ffe08a', 0.8), Math.sin(T * 0.9 + 1) * 0.08);
    stripes(ctx, hexA(YEL, 0.5), 300, 26, 0.9, T * 140);
  } else if (st === 'purple') {
    ctx.fillStyle = hexA(C('mew').main, 0.85);
    ctx.fillRect(-W, -H, W * 3, H * 3);
    for (let j = 0; j < 30; j++) {
      ctx.save();
      ctx.translate(rnd(118, j) * W, ((rnd(119, j) * H - T * 40) % H + H) % H);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      const s = 40 + rnd(120, j) * 60;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    truss(ctx, 110, -200, H + 200, 70, '#e2d6e8');
    truss(ctx, 1810, -200, H + 200, 70, '#e2d6e8');
  } else {
    // (v16, user: the grid did not reach the top-right corner, and at 0:48 that corner went blank) the old
    // 22 x 22 squares ended 1210 px from their centre, short of the top-right corner (1480 px away in the
    // grid's own turned axes) and of anything the camera's travel shows; now one pattern fills far past
    // every edge, and the slide wraps on two squares, so nothing ever jumps or ends
    ctx.save();
    ctx.translate(500, 540);
    ctx.rotate(-0.6);
    ctx.translate((T * 60) % 220, 0);
    ctx.fillStyle = checker(ctx);
    ctx.fillRect(-4400, -4400, 8800, 8800);
    ctx.restore();
  }
  if (o.sparkles ?? true) sparkles(ctx, T, 116 + i, 14, ['#ffffff', tint], {x: 0, y: 0, w: W, h: H}, [14, 34]);
  if (o.pens ?? true) penCrowd(ctx, T, {seed: 10 + i, far: 22, mid: 0, near: 0});
};
/** (v57) each member's own A-section page (her first page in A1): HALO page 0, POPY page 1, MEW page 2. */
const CAP_OF: Record<Member, CapStyle> = {halo: 'yellow', popy: 'red', mew: 'purple'};
const CAP_PAGE: Record<Member, number> = {halo: 0, popy: 1, mew: 2};
const capTint = (st: CapStyle) => (st === 'yellow' ? YEL : st === 'purple' ? C('mew').main : RED);

export const tCapsules9 = (segs: Seg[], a0: number, end: number, styles: CapStyle[], splits: (number | undefined)[] = [], cutAfter: (number | undefined)[] = [], o: {inPage?: {page: number; draw: (ctx: Ctx, T: number) => void}} = {}): Part => {
  const shots: Shot[] = [];
  const rigs: {a: number; b: number; rig: Rig}[] = [];
  segs.forEach((sg, i) => {
    const a = i === 0 ? a0 : Math.max(sg.start - lead, cutAfter[i] ?? -1);
    const b = i + 1 < segs.length ? Math.max(segs[i + 1].start - lead, cutAfter[i + 1] ?? -1) : end;
    const st = styles[i % styles.length];
    const m = whoOf(sg)[0];
    const lines = splitLine(glyphs(sg.toks), splits[i]);
    const tint = capTint(st);
    const win = st === 'red' ? {x: 900, y: 110, w: 900, h: 860} : st === 'purple' ? {x: 210, y: 90, w: 1500, h: 900} : {x: 160, y: 110, w: 1000, h: 860};
    // arrives with a spring (overshoots once), keeps drifting and rolling slowly, accelerates out the way
    // the heart wipe goes
    const sgn = i % 2 ? -1 : 1;
    const rig0 = live(a, b, {x: W / 2, y: H / 2, z: 1.02, r: 0.035 * sgn}, {
      enter: i === 0 ? {z: 1.12, r: 0.05} : {dx: -820 * sgn, r: -0.14 * sgn, z: 1.16}, // the first line starts on HALO (user)
      spring: true,
      tauIn: 0.1,
      drift: {x: (i + 1 < segs.length ? -16 : -6) * sgn, z: i + 1 < segs.length ? 0.04 : 0.032, r: -0.012 * sgn}, // the last one drifts slower (user)
      exit: i + 1 < segs.length ? {dx: -900 * sgn, r: -0.14 * sgn, z: 1.1} : undefined, // (the last page: intoCut below)
      outDur: 0.26,
      tauOut: 0.07,
    });
    // (v16, user: the last page's push-and-turn was one more of the same transitions) no transition: a plain
    // cut on the music into the colour trio, which arrives on its own push and the three leaping in
    const rig = rig0;
    shots.push(
      camShot(a, b, `capsules ${st} ${m} [spring]`, rig, (ctx, T) => {
        capsuleGround(ctx, T, st, i);
        // the window: costume close-up, still (a very slow push only)
        ctx.save();
        ctx.shadowColor = 'rgba(40,10,40,0.3)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(win.x - 14, win.y - 14, win.w + 28, win.h + 28, 46);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.beginPath();
        ctx.roundRect(win.x, win.y, win.w, win.h, 36);
        ctx.clip();
        ctx.fillStyle = st === 'purple' ? '#ece2ff' : st === 'red' ? '#ffd6d9' : '#fff1c9';
        ctx.fillRect(win.x, win.y, win.w, win.h);
        for (let y = win.y + win.h * 0.55; y < win.y + win.h; y += 40) {
          ctx.fillStyle = hexA('#b48cff', 0.25);
          ctx.fillRect(win.x, y, win.w, 6);
        }
        figAt(ctx, m, 'full', win.x + win.w * 0.5, win.y + win.h * 0.5 - 330, 255);
        ctx.restore();
        // stars rising over the portrait (and beyond the window)
        risingStars(ctx, T, 130 + i, {n: 30, colors: ['#ffffff', YEL, '#ffe27a', tint], speed: 210});
        penCrowd(ctx, T, {seed: 20 + i, far: 0, mid: 0, near: 2});
        // the line on ribbons (scene space: they ride the camera with the window)
        const cx0 = st === 'red' ? 560 : win.x + win.w * 0.36;
        const cy0 = st === 'red' ? 430 : win.y + win.h * 0.32;
        const rc: [string, string] = st === 'yellow' ? ['#ffb020', '#d97a00'] : st === 'purple' ? ['#a57bff', C('mew').deep] : [RED, '#a8173d'];
        // a line already being sung when its page arrives (it waited for the フワ！) comes in at once
        const late = sg.start - lead < a - 0.05;
        lines.forEach((ln, j) => ribbon(ctx, ln, T, cx0 + j * 130, cy0 + j * 190, 84, a + (late ? 0.0 : 0.14) + j * (late ? 0.12 : 0.16), rc, (j % 2 ? 0.05 : -0.05) * sgn));
        // (v17, user: the フワ！ bubbles stood apart from the page) things that belong to this page, in its space:
        // they leave with it
        if (o.inPage?.page === i) o.inPage.draw(ctx, T);
      }),
    );
    if (i + 1 < segs.length) shots.push(heartWipe(b, hexA(tint, 0.95), sgn));
    rigs.push({a, b, rig});
  });
  return {shots, fx: blurOf(rigs)};
};

/** フワ！ calls drawn inside the capsule page they belong to (v17): they move and leave with it. */
export const fuwaDraw = (calls: {t: number; text: string}[], cut?: number) => (ctx: Ctx, T: number) =>
  tFuwa(calls, cut).shots.forEach((sh) => {
    if (T >= sh.a && T < sh.b) sh.draw(ctx, T);
  });

/** フワ！ calls: fluffy cloud bubbles that puff up and float away. */
export const tFuwa = (calls: {t: number; text: string}[], cut?: number): Part => ({
  shots: calls.map((c, i) => ({
    a: c.t - 0.06,
    // (user, v15) both stay until the heart wipe covers them at the cut (z 7, the wipe is z 9)
    b: cut ?? c.t + 0.62,
    z: 7,
    label: 'fuwa',
    draw: (ctx: Ctx, T: number) => {
      const lt = T - (c.t - 0.06);
      // second call low on the left, under the two capsule lines (at y 640 it covered 場所へ)
      const x = i % 2 ? 400 : 1460;
      const y = (i % 2 ? 880 : 280) - lt * 60;
      const s = easeOutBack(clamp(lt / 0.22), 2.4) * (1 + 0.04 * Math.sin(lt * 9));
      const out = cut === undefined ? clamp((lt - 0.75) / 0.3) : 0;
      ctx.save();
      ctx.globalAlpha = 1 - out;
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,120,180,0.45)';
      ctx.shadowBlur = 30;
      const puffs: [number, number, number][] = [[-150, 10, 95], [-60, -50, 110], [60, -55, 105], [150, 5, 95], [80, 55, 95], [-80, 55, 95], [0, 10, 120]];
      puffs.forEach(([px, py, r]) => {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowColor = 'transparent';
      label(ctx, c.text, 0, 6, 110, BUB('#ff9ac8', '#ff5aa0', hexA('#c0306a', 0.4)), 0.5, -0.02);
      ctx.restore();
      // small puffs drifting off
      for (let j = 0; j < 6; j++) {
        const k = clamp((lt - 0.08) / 0.8);
        if (k <= 0) continue;
        const ang = (j / 6) * Math.PI * 2 + i;
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * (230 + 200 * k), y + Math.sin(ang) * (160 + 140 * k), 34 * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    },
  })),
  fx: [],
});

// ---------------------------------------------------------------- ここに来たなら / なりふり構わずに

/** (v35) The penlights at the bottom of the colour-trio shot (a crowd row and five near sticks, out of focus), in
 *  the shot's scene space; `pop` lifts them (px) - the crowd answering the calls. Shared by the bridge trio shot
 *  before it, so the row runs on through the cut unchanged. */
const trioPens = (ctx: Ctx, T: number, lift?: (T: number, id: number, phase: number) => number) => {
  // (v37) each stick lifted by its own arm (lift), held a little straighter the higher it goes
  // (v43) with lift (the bridge, 2:36-2:41): the beat-locked swing (one cycle a bar), the hops, a little smaller
  const P = CROWD_CALLS;
  const sc = lift ? P.bridgeScale : 1;
  penCrowd(ctx, T, lift
    ? {seed: 13, far: 0, mid: 9, near: 0, y: H - P.bridgeRaise, people: true, amp: P.sway, beats: P.swayBeats, sync: {spread: P.phaseSpread}, scale: sc, lift: (id, ph) => lift(T, id, ph), liftRef: P.height, straighten: P.straighten}
    : {seed: 13, far: 0, mid: 9, near: 0, y: H, amp: P.sway});
  const {c, g} = layer('trioNear');
  g.setTransform(ctx.getTransform());
  // (v43, user: the leftmost one purple) MEW's colour on the left
  ([[C('mew').main, 260, 0.55], [YEL, 1680, -0.5], [PINK, 960, 0.08], [RED, 600, -0.25], [YEL, 1320, 0.3]] as [string, number, number][]).forEach(([col, x, r], i) => {
    const ph = lift ? (rnd(911, i) - 0.5) * 2 * P.phaseSpread : 0;
    const lf = lift ? lift(T, 900 + i, ph) * 1.3 : 0;
    const st = 1 - P.straighten * clamp(lf / (P.height * 1.3));
    const sw = lift ? swayCurve((2 * Math.PI * (beatAt(T) + P.beatLead)) / P.swayBeats + ph) : Math.sin((2 * Math.PI * T) / (8 * BEAT) + i * 0.4);
    const ang = (r + P.nearSway * sw) * st;
    const cy = 1080 + 160 - lf + (1 - sc) * 450 - (lift ? P.bridgeRaise : 0);
    const L = 900 * sc, w = 210 * sc;
    // (v50, user) in the bridge each big near stick is held too: the same arm and fist as 0:14-18 (holder)
    const hx = x - Math.sin(ang) * L * 0.5, hy = cy + Math.cos(ang) * L * 0.5;
    if (lift) holder(g, hx, hy, w, i % 2 ? 1 : -1, ang);
    penlight(g, x, cy, L, w, ang, col);
    // (v52) the fist round the lower handle (gripFist), as at 0:14-18
    if (lift) gripFist(g, hx, hy, w, ang, col);
  });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawBlurred(ctx, c, 8);
  ctx.restore();
};

/** ここに来たなら (after reference 1, 48.9-50.8 s): the three small in the centre, a tunnel of hearts streaming
 *  out from behind them (pink / mint, some striped), dotted rays bursting, the line in big chunky letters
 *  popping one by one across the middle; the camera pushes in as reference 2 (x1.34) and turns slowly. */
const TUN = ['#ff8fd0', '#9ff0f2', '#ffffff', '#ffb3e6', '#bff6f7'];
export const tColorTrio9 = (sg: Seg, a: number, b: number, o: {pens?: (T: number, id: number, phase: number) => number; onRig?: (r: Rig) => void; sweepOut?: boolean; flashIn?: boolean; midPush?: number; z0?: number; pushAcc?: number; aim?: {x: number; y: number}; cutZoom?: number; hold?: {z: number; y: number; r: number; drift: number; accelAt: number; endZ: number; tau: number}} = {}): Part => {
  // (user) the push comes in fast and slows (not uniform), then accelerates out: (v15) a hard, visible push
  // into the cut (x3, turning) before the white, not a white hiding a small push
  // (v22, bridge only: hold) from the first frame the framing the push used to reach later; a very slow creep
  // forward, and only from `accelAt` one exponential push (speed rising from the creep's) onto `aim`, ending
  // at zoom `endZ` on the cut
  const hd = o.hold;
  const holdRig: Rig | null = hd
    ? (() => {
        const creep: Rig = (T) => {
          const t = Math.max(0, T - a);
          return {x: 960, y: hd.y, z: hd.z * Math.exp(hd.drift * t), r: hd.r + 0.006 * t};
        };
        const zAt = creep(hd.accelAt).z;
        return intoCut(creep, b, {dur: b - hd.accelAt, tau: hd.tau, zoom: hd.endZ / zAt, rot: 0.12, to: o.aim ?? {x: 960, y: 470}});
      })()
    : null;
  const rig = holdRig ?? intoCut(
    (T: number): Cam => {
      const t = Math.max(0, T - a);
      const D = b - a;
      const inP = (1 - Math.exp(-t / 0.35)) / (1 - Math.exp(-D / 0.35));
      // (+ a slow drift on, so the middle never stands still)
      // (v19, bridge only: pushAcc) the push gets faster and faster all through the shot instead of easing in
      if (o.pushAcc) {
        // (v21, bridge: aim) the centre travels onto the aim point as the push builds (in step with the zoom)
        const lz = (o.midPush ?? 0.035) * t + o.pushAcc * t * t;
        const D1 = Math.max(0.1, D - 0.55);
        const p = clamp(lz / ((o.midPush ?? 0.035) * D1 + o.pushAcc * D1 * D1));
        const am = o.aim ?? {x: 960, y: 540};
        return {x: 960 + (am.x - 960) * p, y: 540 + (am.y - 540) * p, z: (o.z0 ?? 1) * Math.exp(lz), r: -0.05 + 0.02 * t + 0.01 * t * t};
      }
      return {x: 960, y: 540, z: (o.z0 ?? 1) * Math.pow(1.34, inP) * Math.exp((o.midPush ?? 0.035) * t), r: -0.05 + 0.04 * inP + 0.014 * t};
    },
    b,
    {dur: 0.55, tau: 0.14, zoom: o.cutZoom ?? 3.2, rot: 0.22, to: o.aim ?? {x: 960, y: 470}},
  );
  const gs = noSpace(glyphs(sg.toks));
  o.onRig?.(rig);
  return {
    shots: [
      camShot(a, b, `colour trio ${sg.text}`, rig, (ctx, T) => {
        const lt = T - a;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-W, -H, W * 3, H * 3);
        // heart tunnel: hearts born small at the centre, growing out past the frame (one every 0.22 s)
        const per = 0.22;
        const n0 = Math.floor(lt / per);
        for (let q = n0 - 9; q <= n0; q++) {
          const age = lt - q * per;
          if (age < 0) continue;
          const sz = 60 * Math.exp(age * 1.9);
          if (sz > 5200) continue;
          const col = TUN[((q % 5) + 5) % 5];
          ctx.save();
          heartPath(ctx, 960, 470 + sz * 0.3, sz);
          ctx.fillStyle = col;
          ctx.fill();
          if (q % 3 === 0) {
            ctx.clip();
            stripes(ctx, hexA('#ffffff', 0.55), 90, 34, -0.7, lt * 120);
          }
          ctx.restore();
        }
        // dotted rays bursting out
        for (let r = 0; r < 40; r++) {
          const ang = (r / 40) * Math.PI * 2 + rnd(171, r) * 0.1;
          for (let d = 0; d < 7; d++) {
            const dist = ((lt * (500 + rnd(172, r) * 300) + d * 150 + rnd(173, r) * 150) % 1150) + 120;
            ctx.fillStyle = [PINK, '#5fd6e0', YEL, LAV, '#ff9a3d'][(r + d) % 5];
            ctx.beginPath();
            ctx.arc(960 + Math.cos(ang) * dist * 1.4, 470 + Math.sin(ang) * dist, 3 + dist * 0.012, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // the three, small: a silhouette in her own colour offset behind each (v59, user: POPY's and HALO's were swapped)
        const sil: Record<Member, string> = {mew: '#c9a8ff', popy: C('popy').main, halo: C('halo').main};
        (['mew', 'popy', 'halo'] as Member[]).forEach((m, i) => {
          const x = [730, 960, 1190][i];
          // a natural jump in (user, v14): a real ballistic arc under constant gravity, falling back onto the spot.
          // (v16, user: still stiff) it now leaps up from below the frame (the whole body comes up into view),
          // on a curve (each one drifts in from her own side), with stretch while fast (squash and stretch
          // follow the vertical speed), a lean into the jump that straightens at the top, and a softer
          // landing (squash, rebound, settle)
          const J = 0.64;
          const u = (lt - 0.03 - i * 0.08) / J;
          if (u <= 0) return;
          const S0 = 700;
          const HA = 85;
          const q = S0 + HA;
          const Bq = -2 * (q + Math.sqrt(q * HA));
          const Aq = -Bq - S0;
          const uu = Math.min(u, 1);
          const arc = u < 1 ? Aq * uu * uu + Bq * uu + S0 : 0;
          const vy = u < 1 ? (2 * Aq * uu + Bq) / Math.abs(Bq) : 0; // -1 at take-off .. 0 at the top .. + falling
          const side = i - 1 || (i === 0 ? -1 : 1);
          const dx = u < 1 ? side * 150 * Math.pow(1 - uu, 2) : 0;
          const lean = u < 1 ? -side * 0.16 * Math.pow(1 - uu, 1.5) + side * 0.03 * Math.sin(Math.PI * uu) : 0;
          const y = 425 + arc;
          const l = (u - 1) * J;
          const st = u < 1 ? 1 + 0.13 * Math.min(1, Math.abs(vy)) : 1;
          const sq = l > 0 && l < 0.45 ? 1 - 0.1 * Math.exp(-l * 9) * Math.cos(l * 24) : 1;
          const sy = st * sq;
          const feet = 425 + 84 * 7.5;
          const pivotY = u < 1 ? y + 84 * 3.6 : feet; // in the air it stretches about the waist, on the ground about the feet
          ctx.save();
          ctx.translate(x + dx, pivotY);
          ctx.rotate(lean);
          ctx.scale(1 / Math.sqrt(sy), sy);
          ctx.translate(-(x + dx), -pivotY);
          figAt(ctx, m, 'full', x + dx + 28, y + 9, 84, 'silhouette', sil[m], undefined, {shadow: 0});
          figAt(ctx, m, 'full_laugh', x + dx, y, 84);
          ctx.restore();
        });
        paper(ctx, T, a, 120, 70, [RED, YEL, PINK, '#5fd6e0'], 200);
        // penlights low at the bottom, slow (one side per bar); (v35) they rise on the crowd's calls (o.pens)
        trioPens(ctx, T, o.pens);
        // the line: big chunky letters across the middle, each its own pop (scene space: pushed in with the rest)
        const ps = layoutLine(gs, {size: 98, tracking: 0.02, rotJitter: 0.06, yJitter: 8, seed: 5});
        ctx.save();
        ctx.translate(960, 640);
        drawPlaced(ctx, ps, T, {fill: ['#ff8ccf', '#f0479a'], stroke2: '#ffffff', sw2: 0.16, extrude: {color: '#b02a72', dx: 0.04, dy: 0.06}}, {kind: 'fly', at: a + 0.12, step: 0.045, dist: 1.1, seed: 17});
        ctx.restore();
      }, (ctx, T) => {
        const sw = o.sweepOut === false ? 0 : prog(T, b - 0.4, b);
        if (sw > 0) {
          penlight(ctx, lerp(2300, -300, easeInOut(sw)), 620, 1500, 420, 0.5, RED);
          white(ctx, Math.pow(prog(T, b - 0.08, b), 1.5));
        }
      }),
    ],
    fx: [rigBlur(rig, a, b), ...(o.flashIn === false ? [] : [flashAt(a, 0.25, 0.5)])],
  };
};

// ---------------------------------------------------------------- 損！ x3 / そう！ x3: three cards, left to right

export const tCards = (words: Seg[], a: number, b: number, members: Member[], color: [string, string]): Part => {
  const rig = live(a, b, {x: W / 2, y: H / 2, z: 1, r: 0.02}, {enter: {z: 0.9, r: -0.05}, drift: {z: 0.05, r: 0.012}});
  const OUT = 0.26; // the cards stay over the cut, then fly off fast over the start of B
  const card = (ctx: Ctx, T: number, i: number, w: Seg, out: number) => {
    const t0 = i === 0 ? Math.min(a, w.start - 0.06) : w.start - 0.06;
    const k = clamp((T - t0) / 0.16);
    if (k <= 0) return;
    const s = easeOutBack(k, 2.4);
    const m = members[i % members.length];
    const cx = 390 + i * 570;
    // fly off: up and outward, turning, accelerating; the first card first, the third (newest) last
    const u = clamp((out - i * 0.12) / 0.62);
    const e = Math.pow(u, 2.2);
    ctx.save();
    ctx.translate(cx + (i - 1) * 900 * e, 540 - 1500 * e);
    ctx.rotate((i - 1) * 0.04 + (i - 1 || 1) * 0.7 * e);
    ctx.scale(s, s);
    ctx.shadowColor = 'rgba(60,20,70,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(-284, -474, 568, 948, 36);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.roundRect(-270, -460, 540, 920, 26);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = C(m).light;
    ctx.fillRect(-300, -500, 600, 1000);
    stripes(ctx, hexA('#ffffff', 0.25), 120, 40, 0.5, T * 80);
    figAt(ctx, m, 'full_wink', 0, -230, 210); // (v16, user) 損！/ そう！ wink
    ctx.restore();
    ctx.translate(-80, 300);
    ctx.rotate(-0.12);
    label(ctx, noSpace(glyphs(w.toks)).map((g) => g.ch).join(''), 0, 0, 200, BUB(color[0], color[1], hexA(color[1], 0.5)), 0.5, -0.04);
    ctx.restore();
  };
  return {
    shots: [
      camShot(a, b, 'cards', rig, (ctx, T) => {
        bg(ctx, T, 140, PINK, 0.08);
        // (v17, user: the ground under the cards changed abruptly) the ground flashes white under the cards into
        // the cut (the next shot, the stage, comes out of the white while the cards fly off over it)
        const wf = Math.pow(prog(T, b - 0.14, b), 1.4);
        if (wf > 0) {
          ctx.save();
          ctx.globalAlpha = wf;
          ctx.fillStyle = '#fff8fc';
          ctx.fillRect(-W, -H, W * 3, H * 3);
          ctx.restore();
        }
        words.forEach((w, i) => card(ctx, T, i, w, 0));
        sparkles(ctx, T, 160, 20, ['#ffffff', YEL], {x: 0, y: 0, w: W, h: H}, [14, 36]);
      }),
      {
        a: b,
        b: b + OUT,
        z: 9,
        label: 'cards fly off',
        draw: (ctx, T) => inCam(ctx, rig(b), () => words.forEach((w, i) => card(ctx, T, i, w, (T - b) / OUT))),
      },
    ],
    fx: [rigBlur(rig, a, b), ...words.map((w) => flashAt(w.start - 0.06, 0.12, 0.25))],
  };
};

// ---------------------------------------------------------------- bridge: quick cuts on the calls (circle windows), colour trio

/** (v34, v35) The crowd's two B小町！フッフー！ at 2:36-2:41. (v35, user: no extra row of cheap flat sticks - the
 *  colour-trio shot has penlights already) the colour-trio row of penlights is drawn already in the trio shot
 *  before it (fixed in the frame: it does not go up with the three or the camera drop) and runs on through the
 *  cut; on each pair of calls the whole row is thrust up a little and pumps on the beat, then sinks back to its
 *  slow sway (v44: callRaise). The calls themselves fly up from the row toward the stage. Parameters: tuning.ts
 *  CROWD_CALLS. */
/** Quintic smoothstep: 0 -> 1 with zero velocity and acceleration at both ends. */
const smoother = (x: number) => {
  const u = clamp(x);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
/** (v46, user) each pair of calls is one bar: B小町 on the bar line (the stick at its left end), フッフー ending on
 *  the next one. Every stick runs a closed loop on its own swing cycle: still at rest at the left end, raised on
 *  the way right, lowered on the way back, and at the left end again exactly where it was one cycle before. Both
 *  moves are quintic eases (no overshoot, no cushion). Returns px up for (T, stick id, stick swing phase). */
const callRaise = (shouts: {t: number}[]) => {
  const P = CROWD_CALLS;
  // the bar (in swing cycles) of each B小町
  const bars = shouts.filter((_, k) => k % 2 === 0).map((s) => Math.round(beatAt(s.t) / P.swayBeats));
  return (T: number, id: number, ph = 0) => {
    const amp = P.height * (1 + (rnd(72, id) - 0.5) * 2 * P.ampVar);
    // this stick's own cycle: an integer exactly at its left end (sway = -cos(2π·beat/beats + ph))
    const c = (beatAt(T) + P.beatLead) / P.swayBeats + ph / (2 * Math.PI);
    let v = 0;
    for (const n of bars) {
      const w = c - n;
      if (w <= 0 || w >= 1) continue;
      v += amp * (smoother(w / P.riseEnd) - smoother((w - P.fallStart) / (1 - P.fallStart)));
    }
    return v;
  };
};

/** (v27) 2:37 bridge trio: the camera drops (the three and everything go up) into the cut.
 *  LEAD = seconds before the cut the drop starts (bigger = earlier); TAU = time constant (smaller = slow start,
 *  hard finish; bigger = more even); DIST = how far it falls by the cut, scene px (~2600 takes the three out of
 *  the top of the frame). */
const BRIDGE_DROP = {LEAD: 0.5, TAU: 0.12, DIST: 2600};

export const tBridgeCuts = (a: number, b: number, calls: number[], fuT = b - 0.41, shouts: {t: number; end: number; text: string}[] = []): Part => {
  const pop = callRaise(shouts);
  const c = [a, calls[0] - 0.08, calls[1] - 0.08, calls[2] - 0.08, b];
  const circ = (m: Member, k: Kind, col: string, i: number) => (ctx: Ctx, T: number) => {
    const lt = T - c[i];
    // in fast (exponential), keeps sliding and turning slowly, out accelerating toward the next one's side
    const dir = i % 2 ? -1 : 1;
    const e = Math.exp(-lt / 0.08);
    const u = T - (c[i + 1] - 0.2);
    const g = u > 0 ? (Math.exp(u / 0.06) - 1) / (Math.exp(0.2 / 0.06) - 1) : 0;
    ctx.fillStyle = C(m).light;
    ctx.fillRect(0, 0, W, H);
    bg(ctx, T, 150 + i, C(m).main, 0.3);
    stripes(ctx, hexA('#ffffff', 0.3), 200, 60, 0.7 * dir, lt * 160);
    ctx.save();
    ctx.translate(960 + dir * 600 * e - dir * 40 * lt - dir * 700 * g, 540);
    ctx.rotate(-dir * 0.5 * e + dir * 0.05 * lt + dir * 0.4 * g);
    ctx.beginPath();
    ctx.arc(0, 0, 470, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.save();
    ctx.clip();
    faceShot(ctx, m, m === 'mew' ? 'full' : k, 0, 40, 500);
    ctx.restore();
    ctx.lineWidth = 30;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  };
  const shots: Shot[] = [
    {a: c[0], b: c[1], label: 'bridge halo wink', draw: circ('halo', 'wink', YEL, 0)},
    {a: c[1], b: c[2], label: 'bridge popy kiss', draw: circ('popy', 'kiss', PINK, 1)},
    {a: c[2], b: c[3], label: 'bridge mew wink', draw: circ('mew', 'wink', RED, 2)},
  ];
  const trioA = c[3];
  const mid = Math.min(trioA + 1.4, b - 1.0);
  // the reference camera here: a fast tilt (content rising ~400 px, decelerating), no zoom; we start with the
  // faces low and keep 60 % of the rise, tilted
  // (v16, user: the move up looked stiff) a smooth analytic tilt instead of the measured track (whose frame to
  // frame noise read as a judder): the content rises 240 px decelerating, then keeps drifting
  // (v27, user: the three should go up because the whole camera drops, faster and faster; timing and acceleration
  // open) the camera falls BRIDGE_DROP.DIST scene px in the last BRIDGE_DROP.LEAD s before the cut, exponential
  // with time constant TAU on top of the drift (speed and acceleration start from the drift's: no jump)
  const dropEx = (s: number) => (s > 0 ? Math.exp(s / BRIDGE_DROP.TAU) - 1 - s / BRIDGE_DROP.TAU : 0);
  const dropK = BRIDGE_DROP.DIST / dropEx(Math.min(BRIDGE_DROP.LEAD, mid - trioA));
  const drop = (T: number) => dropK * dropEx(T - (mid - BRIDGE_DROP.LEAD));
  const rigT: Rig = (T) => {
    const t = Math.max(0, T - trioA);
    return {x: 960, y: 250 + 240 * (1 - Math.exp(-t / 0.32)) + 14 * t + drop(T), z: 0.95 * Math.exp(0.02 * t), r: -0.07 + 0.012 * t};
  };
  shots.push(
    camShot(trioA, mid, 'bridge trio', rigT, (ctx, T) => {
      // the tile background follows the falling camera (shifted by whole tiles' worth: it reads as fixed)
      ctx.save();
      ctx.translate(0, drop(T));
      geo(ctx, T, {seed: 155, tint: LAV, tintA: 0.1, vx: 18, vy: 10, shiftY: drop(T)});
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.3;
      sunburst(ctx, 960, 420, 20, '#ffffff', (T - trioA) * 0.3);
      ctx.restore();
      riseShapes(ctx, T, trioA - 1, 'far', {seed: 31});
      // (v15 had the three rising with the camera into the next scene's jump - the user liked the link; v17: a
      // crouch and push-off) (v19, user: they should not jump here) they stay as they are and then shoot up out of
      // the top of the frame, faster and faster (exponential), one just after the other (MEW, POPY, HALO); the
      // next scene picks them up still rising from below
      // (v27) they stay where they are; the camera falls (rigT)
      ([['halo', 1420, 320, 240], ['mew', 470, 300, 240], ['popy', 1020, 500, 258]] as [Member, number, number, number][]).forEach(([m, x, y, f]) => {
        figAt(ctx, m, 'full', x, y, f);
      });
      riseShapes(ctx, T, trioA - 1, 'mid', {seed: 32});
      floatGlow(ctx, T, 33, trioA, 12);
    }),
  );
  // (v17, user: after they jump up the push in was too slow) a steady push of ~20 %/s through the middle
  // (v19, user: start farther away, push faster and faster) it starts at 0.72x and accelerates the whole way:
  // ~30 %/s at the start, ~80 %/s at the end, then the push into the cut
  // (v20, user: more acceleration - the speed should change faster; same start) 0.72x as before, ~15 %/s at the
  // start, ~140 %/s at the end (was 30 -> 86 %/s), then the push into the cut
  // (v21, user: a much slower start, more acceleration; end on POPY's face, not her chest) ~3 %/s at the
  // start, ~150 %/s at the end; the centre moves onto POPY's face (960, 425) with the push, and the push
  // into the cut ends there (x2.6, face ~ 2/3 of the frame height)
  // (v23, user: the creep read as standing still) 2 %/s -> 9 %/s (x1.23 by the フ)
  // (v22, user: after the jump-in start at the framing of 2:40.329 (x1.31, centre y 499), creep forward very
  // slowly, and only push in hard from the フッフー) 2 %/s creep; from the first フ (161.34) one exponential
  // push onto POPY's face, x8.5 at the cut
  let ctRig: Rig | null = null;
  const ct = tColorTrio9({who: [], toks: [], start: mid, end: b, text: ''}, mid, b, {pens: pop, onRig: (r) => (ctRig = r), sweepOut: false, aim: {x: 960, y: 425}, hold: {z: 1.31, y: 499, r: -0.0085, drift: 0.14, accelAt: Math.min(b - 0.25, fuT), endZ: 8.5, tau: 0.1}});
  if (shouts.length) {
    // (v35) the colour trio's penlight row, already in the trio shot, framed as the colour trio's first frame and
    // fixed there (it does not go up with the three or with the camera drop): no seam at the cut
    const first = ctRig!(mid);
    shots.push({
      a: trioA,
      b: mid,
      z: 5,
      label: 'bridge trio penlights',
      draw: (ctx, T) => inCam(ctx, first, () => trioPens(ctx, T, pop)),
    });
    // (v59, user) no B小町！/ フッフー！ lettering: the crowd's calls are heard, only the penlights answer
  }
  return {shots: [...shots, ...ct.shots], fx: [rigBlur(rigT, trioA, mid), ...ct.fx]};
};
