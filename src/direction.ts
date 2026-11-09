// THE DIRECTION OF THIS SONG, after the second reference (魔界ノりりむ / 葛葉 / 卯月コウ cover, same
// arrangement; composition time T = that video's time + 2.5 s). Cut times are the reference's,
// measured frame by frame (docs/ref2_shotlist.md); lyric timing comes from the SVP.
// Lyrics appear whole (a short cascade, not tied to the voice). The only syllable-by-syllable text is
// 「ア・ナ・タのアイドル / サインはB」 in the intro, reprise and outro (agreed exception).

import {DURATION, Member, NAMES} from './config';
import {P, Seg, runs, segments} from './lib/lyrics';
import {EIGHTH, beatT} from './lib/time';
import {Part, Shot} from './scenes/templates';
import {IntroTimes} from './scenes/ref2';
import {riseCover, titleFancy, tBeamPush, tBridgeCuts, tCallWall9, tCapsules9, tCards, tColorTrio9, tCredits9, fuwaDraw, tIntro9, tOmachi, tPendulum, tPortraits9, tPreStack, tSpoken9, tTour} from './scenes/g9';
import {CreditLine, chunk, flashCut, tBSection, tBakures, tBridgeStage, tChorusWide, tFinale, tSolo, tPreShow, tStageCredits, tStageSingles, tStageWide} from './scenes/stage2';

import {joinPenlightSwing, joinPenlightWipe, penSwingWindow} from './scenes/penlightWipe';

const S = (id: string) => P(id).start;
const one = (id: string): Seg => runs([id])[0];
const lead = EIGHTH;

/** Credits on the empty stage at the end. Only real roles; edit freely.
 *  `small`: a role heading (small, shown together with the line after it).
 *  >>> Put your name in place of xxxxx below (tuning and the MV are yours). <<< */
export const ENDING_CREDITS: CreditLine[] = [
  {text: 'VOCAL', small: true},
  {text: 'POPY・MEW・HALO'},
  {text: 'Synthesizer V AI 夢ノ結唱'},
  {text: 'TUNING・MV', small: true},
  {text: '小姨媽初音'},
];

/** Syllable times of 「ア・ナ・タのアイドル」「サインはB」 and the singer of the チュッ (from the SVP). */
const introTimes = (l1: string, l2: string, chu: string): IntroTimes => {
  const a = P(l1).toks;
  const b = P(l2).toks;
  const at = (toks: typeof a, ch: string, from = 0) => toks.slice(from).find((t) => t.s === ch)?.t0 ?? toks[0].t0;
  const iNo = a.findIndex((t) => t.s === 'の');
  const chuM = (P(chu).toks[0]?.who?.[0] ?? 'popy') as Member;
  return {a: a[0].t0, na: at(a, 'ナ'), ta: at(a, 'タ'), no: at(a, 'の'), ai: at(a, 'ア', iNo + 1), ii: at(a, 'イ', iNo + 1), doru: at(a, 'ド'), ru: at(a, 'ル'), sa: at(b, 'サ'), i: at(b, 'イ'), n: at(b, 'ン'), ha: at(b, 'は'), b: at(b, 'B'), chu: P(chu).start, chuM};
};

// scatter positions (screen) for the giant letters around a close-up, reading order kept
const POS4A: [number, number][] = [[1500, 250], [1690, 470], [300, 520], [430, 830]];
const POS4B: [number, number][] = [[1520, 300], [1660, 700], [270, 380], [390, 790]];
const POS2: [number, number][] = [[330, 560], [1600, 560]];
// サイリウム around the three: kept to the lower half and the edges (self-check: the top corners sat on the faces)
const POS5: [number, number][] = [[1620, 330], [1750, 660], [300, 330], [180, 660], [1250, 900]];
// B3 サイリウム: higher (user: the words and the people sat too low)
// (v44, user: at 3:01 they covered MEW and HALO; keep the layout, move them) the same arrangement as before
// (サ イ right column, リ ウ left column, ム low right of centre), placed as seen at 3:01 (T 182.2) outside MEW and
// HALO and between POPY's and HALO's legs; the letter size is unchanged
const POS5B_AT = 182.2;
// (v45, user: サイリウ further in - anything short of covering a face) サ イ just right of HALO's face, リ ウ just left of MEW's
const POS5B: [number, number][] = [[1600, 230], [1600, 600], [250, 275], [250, 580], [1180, 890]];

/** (v29, user: the stage lights start coming up when the LEFT (POPY, red) penlights light and are fully on once
 *  the RIGHT (HALO, yellow) ones have lit) START = seconds after the left section lights (bigger = later start);
 *  FULL = seconds after the right section lights (bigger = later full, a slower fade-up). The fade-up between the
 *  two is a smooth S curve. (v28: from the middle section) */
const PRESHOW_LIGHTS = {START: 0, FULL: 0.3};

export const buildTimeline = (): Part => {
  const parts: Part[] = [];
  const add = (p: Part) => parts.push(p);
  const SON: [string, string] = ['#ffb347', '#ff6a1a'];
  const calls = (ids: string[]) => ids.map((id) => ({t: S(id), text: P(id).toks.map((t) => t.s).join('')}));

  // ---- intro: one syllable per cut; アイドル pops POPY (then MEW, then HALO); チュッ per the SVP
  const s0 = S('L1P0') - 0.142;
  // ---- pre-show (v16; v17, user: black and silent first, then quickly red, purple, yellow around the start of
  // the music, then the stage lights): the sections half a beat apart (POPY left, MEW in the middle, HALO
  // right), the stage lights on the beat at 2.44 s (the riser before ア starts at 2.38 s)
  add(tPreShow(0, s0, {sections: [
    // (v19, user: all a little earlier, so the stage lights stay on longer before ア) one beat earlier
    {t: beatT(0.5), m: 'popy', from: -1, to: 0.36},
    {t: beatT(1), m: 'mew', from: 0.36, to: 0.64},
    {t: beatT(1.5), m: 'halo', from: 0.64, to: 2},
  ], lightsOn: beatT(0.5) + PRESHOW_LIGHTS.START, lightsFull: beatT(1.5) + PRESHOW_LIGHTS.FULL})); // (v29, user) the stage lights fade up from the left section to the right one
  add(tIntro9(s0, 13.58, introTimes('L1P0', 'L2P0', 'L2P1'), 'mew'));

  // ---- credits in the spotlights (ring iris in), the calls pop as big heart bubbles
  const sp = runs(['L5P0', 'L5P1', 'L6P0', 'L7P0']);
  const credits = tCredits9(13.58, penSwingWindow().b, // (v48) the credits run on under the swing until it has crossed
    ['L3P0', 'L3P1', 'L4P0', 'L4P1'].map(S), ['L3P0', 'L3P1', 'L4P0', 'L4P1'].map((id) => P(id).end)); // (v42) ends: the penlights bounce on the calls

  // ---- spoken lines, call wall
  // (user, v15) MEW's and HALO's lines in two rows like POPY's, the second row when it is sung
  // (v46, user) one red penlight swung across the lens from the audience: swept = the spoken lines (PEN_SWING)
  add(joinPenlightSwing(credits, tSpoken9(sp, 29.0, 19.12, [undefined, '待ち遠しくて', '今日楽しみで']), 19.12));
  add(tCallWall9(29.0, 30.08, 'オレモー！', {preIn: 0.42})); // (v17) the オレモー！ bubbles burst over the last spoken portrait

  // ---- Pre 1 (singers stacking), 君も！ x3 (pendulum window), お待ちどうさま (two-stage camera)
  add(tPreStack(runs(['L8P0', 'L9P0', 'L9P1', 'L10P0']), 30.08, 37.75));
  add(tPendulum([one('L11P0'), one('L11P1'), one('L11P2')], 39.96, 37.75));
  add(tOmachi(one('L12P0'), 39.96, 41.12, 3, {textAt: 39.98})); // (v19, user) the words from the cut on

  // ---- A 1: still costume windows, stars rising, capsules; フワ！ calls
  // (user) both フワ！ stay on MEW's page: the cut to POPY waits until the second one has gone
  // (user, v15) the wipe a little earlier; both フワ！ stay until the heart covers them
  const fuwaCut1 = S('L14P2') + 0.34; // (v16, user: the cut over faster, the next line sooner)
  // (v17, user) the フワ！ bubbles are part of MEW's page (page 2): they slide off with it
  add(tCapsules9(runs(['L13P0', 'L13P1', 'L14P0', 'L15P0']), 41.12, 48.92, ['yellow', 'red', 'purple', 'red'], [-1, -1, 8, 3], [undefined, undefined, undefined, fuwaCut1], {inPage: {page: 2, draw: fuwaDraw(calls(['L14P1', 'L14P2']), fuwaCut1)}}));
  add(joinPenlightWipe(
    tColorTrio9(one('L16P0'), 48.92, 50.88, {flashIn: false, sweepOut: false}),
    tCards([one('L16P1'), one('L16P2'), one('L16P3')], 50.88, 52.1, ['popy', 'mew', 'halo'], SON),
    50.88,
  ));

  // ---- B 1 (one stage, continuous camera; carousel for ちゃんと見えてる 君のサイリウム)
  const b1w = chunk([one('L17P0')], ['客席が', '居ようが居まいが', '関係ない']);
  const b1c = chunk([one('L18P0')], ['会場が大きい', '小さいとか', '気にしない']);
  const b1s = chunk([one('L19P0'), one('L19P1')], ['ちゃんと', '見えてる', '君の', 'サイリウム']);
  add(
    tBSection({
      start: 52.1, // the third 損 card stays until here; the cards leave a little earlier (user)
      cut: 54.79,
      wide: b1w,
      close1: {m: 'mew', c: b1c[0]},
      close2: {m: 'halo', c: b1c[1]},
      back: b1c[2],
      s3: 57.45,
      a1: {m: 'mew', c: b1s[0], pos: POS4A},
      a2: {c: b1s[1], pos: POS4B},
      a3: {m: 'halo', c: b1s[2], pos: POS2},
      a4: {c: b1s[3], pos: POS5},
      end: 63.0,
    }),
  );

  // ---- Chorus 1
  // the jump (and the one face change) on the second cheer of the crowd, just before the second line
  add(tChorusWide(63.0, 68.54, chunk(segments(['L20P0', 'L21P0']), ['今はフーっと吹けば', '飛ぶような', '小さな小さな才能だけど']), {jump: S('L21P0') - 0.35}));
  add(
    tSolo(
      [
        {a: 68.54, b: 69.79, m: 'popy', k: 'main', kind: 'costume'},
        {a: 69.79, b: 71.0, m: 'popy', k: 'main', kind: 'arm'},
        {a: 71.0, b: 72.71, m: 'popy', k: 'laugh', kind: 'upper'},
      ],
      chunk([one('L22P0')], ['私を', '推してくれるのなら']),
    ),
  );
  const bk1 = chunk([one('L22P1')], ['爆レスを', 'あげる']);
  add(tBakures(72.71, S('L23P0') - 0.142, bk1[0], bk1[1], {v: 0}));

  // ---- reprise (アイドル: MEW; チュッ: HALO per the SVP), then a tour of the spotlights
  // (starts on the sung ア like the first intro: S - 0.142; the user found it early)
  // (v15, user: the チュッ ended too late) it lasts as long as in the first intro (0.42 s after the sung チュッ)
  const tourA = S('L24P1') + 0.42;
  add(tIntro9(S('L23P0') - 0.142, tourA, introTimes('L23P0', 'L24P0', 'L24P1'), 'halo'));
  // (v15, user) the photo flash, the jump and the one face change together on the beat at 1:27.81
  add(tTour(tourA, 90.5, {jumpAt: beatT(252), callAt: beatT(256)})); // (v59) callAt: the one B小町！フッフー！ here, on the bar line of beat 256 (1:28.0; found in the audio: it matches the 0:14 calls)

  // ---- Pre 2, 君と！君と！今を！, 楽しまなきゃ
  add(tPreStack(runs(['L25P0', 'L26P0', 'L26P1', 'L27P0']), 90.5, 98.17, {turn: true})); // the star burst hides the change of direction
  add(tPendulum([one('L28P0'), one('L28P1'), one('L28P2')], 100.38, 98.17));
  add(tOmachi(one('L29P0'), 100.38, 101.46, 3, {textAt: 100.4})); // (v26, user) the words from the cut on, like the first お待ちどうさま

  // ---- A 2
  // 5 runs here (引きこもりも / 人見知りも are two singers): the フワ！ line is run 2, so run 3 waits
  // (v14 delayed run 2 by mistake and 普段と違う顔見せてよ was lost)
  const fuwaCut2 = S('L31P2') + 0.34;
  add(tCapsules9(runs(['L30P0', 'L31P0', 'L32P0', 'L32P1']), 101.46, 109.29, ['yellow', 'red', 'purple', 'red'], [-1, -1, 5, undefined], [undefined, undefined, undefined, fuwaCut2], {inPage: {page: 2, draw: fuwaDraw(calls(['L31P1', 'L31P2']), fuwaCut2)}}));
  add(joinPenlightWipe(
    tColorTrio9(one('L33P0'), 109.29, 111.21, {flashIn: false, sweepOut: false}),
    tCards([one('L33P1'), one('L33P2'), one('L33P3')], 111.21, 112.44, ['mew', 'halo', 'popy'], SON),
    111.21,
  ));

  // ---- B 2
  const b2w = chunk([one('L34P0')], ['他人に', '笑われていても', '関係ない']);
  const b2c = chunk([one('L35P0')], ['周りがどうとか', 'こうとか', '気にしない']);
  const b2s = chunk([one('L36P0'), one('L36P1')], ['主張', '強すぎ', '君の', 'サイリウム']);
  add(
    tBSection({
      start: 112.44,
      cut: 115.21,
      wide: b2w,
      close1: {m: 'halo', c: b2c[0]},
      close2: {m: 'mew', c: b2c[1]},
      back: b2c[2],
      s3: 117.87,
      a1: {m: 'halo', c: b2s[0], pos: POS2},
      a2: {c: b2s[1], pos: [[1500, 280], [1660, 640], [300, 520]]},
      a3: {m: 'mew', c: b2s[2], pos: POS2},
      a4: {c: b2s[3], pos: POS5},
      end: 123.42,
    }),
  );

  // ---- Chorus 2
  add(tChorusWide(123.42, 128.96, chunk(segments(['L37P0', 'L38P0']), ['たとえ世界が', '私を拒んで', 'ひとりぼっちを', '感じたとしても']), {jump: S('L38P0') - 0.35, reverse: true}));
  add(
    tSolo(
      [
        {a: 128.96, b: 130.21, m: 'popy', k: 'main', kind: 'costume'},
        {a: 130.21, b: 131.42, m: 'popy', k: 'main', kind: 'arm'},
        {a: 131.42, b: 133.12, m: 'popy', k: 'laugh', kind: 'upper'},
      ],
      chunk([one('L39P0')], ['アナタが', '味方でいてくれたら']),
    ),
  );
  const bk2 = chunk([one('L39P1')], ['怖いものは', 'ないよ']);
  add(tBakures(133.12, 137.08, bk2[0], bk2[1], {v: 1}));

  // ---- interlude: portraits, spotlights pushing in, the stage, quick cuts on the calls
  const third = (145.38 - 137.08) / 3;
  add(riseCover(137.08));
  add(tPortraits9((['popy', 'mew', 'halo'] as Member[]).map((m, i) => ({a: 137.08 + i * third, b: 137.08 + (i + 1) * third, who: [m], word: NAMES[m]})), {end: 'screenOff'})); // (v17) the member video on the screen switches off; the light show starts in the dark
  add(tBeamPush(145.38, 150.83));
  add(tStageWide(150.83, 156.38, [beatT(437), beatT(444)])); // 2:31.24 and (user) 2:33.64, both on the beat
  const bridgeCalls = tBridgeCuts(156.38, 161.75, [156.79, 157.12, 157.66], S('L41P1'), [{t: S('L40P0'), end: P('L40P0').end, text: 'B小町！'}, {t: S('L40P1'), end: P('L40P1').end, text: 'フッフー！'}, {t: S('L41P0'), end: P('L41P0').end, text: 'B小町！'}, {t: S('L41P1'), end: P('L41P1').end, text: 'フッフー！'}]); // (v34) the crowd's calls // (v22) the push in starts on the フッフー

  // ---- bridge: the empty stage with the lines, the big words
  const brLines = chunk([one('L42P0'), one('L42P1'), one('L42P2'), one('L43P0')], ['見てよ 見てよ', '何か始まる', '君との物語が']);
  const brWords = chunk([one('L44P0'), one('L44P1')], ['嗚呼', 'なんて', '素晴らしい', '景色だ！']);
  // (v15, user: the cut came late) right after 君との物語が ends (167.27), not at 嗚呼
  // (v17, user) the faces change on the ば of 素晴らしい (the middle of the 素晴 = すば token), with a jump
  const suba = P('L44P1').toks.find((t) => t.s === '素晴');
  const baT = suba ? (suba.t0 + suba.t1) / 2 : 168.72;
  const bridgeStage = tBridgeStage(161.75, 167.3, 172.75, brLines, {center: brWords.slice(0, 2), right: brWords[2], left: brWords[3]}, {faceAt: baT, wordsEnd: P('L44P1').end});
  add(joinPenlightWipe(bridgeCalls, bridgeStage, 161.75)); // (v27) 素晴らしい 景色だ！ leave after they are sung

  add(flashCut(172.75)); // (v23, user) a white flash on the cut into 客席 (B3)
  // ---- B 3: each alone on the darker stage, then 君の サイリウム pulling back
  const b3k = chunk([one('L47P1')], ['君の', 'サイリウム']);
  const whole = (id: string) => chunk([one(id)], [one(id).text.replace(/\s/g, '')])[0];
  add(
    tStageSingles(
      [
        {m: 'mew', a: 172.75, b: 175.46, c: whole('L45P0')},
        {m: 'halo', a: 175.46, b: 178.17, c: whole('L46P0')},
        {m: 'popy', a: 178.17, b: 180.62, c: whole('L47P0')},
      ],
      {next: {m: 'popy', c: b3k[0], pos: POS2}, around: {c: b3k[1], pos: POS5B, designAt: POS5B_AT}, end: 183.76},
    ),
  );

  add(flashCut(183.76)); // (v19, user) a white flash on the cut into chorus 3
  // ---- Chorus 3 (dutch angle, glow on top)
  add(tChorusWide(183.76, 189.17, chunk(segments(['L48P0', 'L49P0']), ['今はフーっと吹けば', '飛ぶような', '小さな小さな才能だけど']), {confetti: true, dutch: -0.12, glow: true, jump: S('L49P0') - 0.35})); // starts a touch later (user)
  add(
    tSolo(
      [
        {a: 189.17, b: 190.42, m: 'mew', k: 'main', kind: 'costume'},
        {a: 190.42, b: 191.6, m: 'halo', k: 'main', kind: 'arm'},
        {a: 191.6, b: 194.54, m: 'mew', with: 'halo', k: 'laugh', kind: 'faces'},
      ],
      chunk([one('L50P0')], ['私を', '推してくれるのなら']),
    ),
  );
  add(
    tSolo(
      [
        {a: 194.54, b: 195.62, m: 'popy', k: 'main', kind: 'legs'},
        {a: 195.62, b: 197.15, m: 'popy', k: 'main', kind: 'costume'},
        {a: 197.15, b: 198.71, m: 'popy', k: 'laugh', kind: 'upper'},
      ],
      chunk([one('L51P0')], ['アナタが', '味方でいてくれたら']),
    ),
  );
  const bk3 = chunk([one('L52P0')], ['爆レスを', 'あげる']);
  add(tBakures(198.71, S('L53P0') - 0.142, bk3[0], bk3[1], {glow: true, v: 2}));

  // ---- outro (アイドル: HALO; チュッ: POPY), credits on the empty stage, finale with the title, fade to black
  // (v15, user: the チュッ ended too late) cut 0.42 s after it; the credit lines keep their time
  const credA = S('L54P1') + 0.42;
  add(tIntro9(S('L53P0') - 0.142, credA, introTimes('L53P0', 'L54P0', 'L54P1'), 'popy'));
  add(tStageCredits(credA, 216.83, ENDING_CREDITS, 208.8));
  // (v15, user) MEW held a little longer (HALO keeps its slow stretch: the move ends 0.13 s later); the black
  // starts later (222.3, the last ring of the music is gone) and eases in slower (1.7 s)
  add(tFinale(216.83, 218.05, 222.3, DURATION, titleFancy));

  return {shots: parts.flatMap((p) => p.shots), fx: parts.flatMap((p) => p.fx)};
};

export type {Shot};
export {segments, lead};
