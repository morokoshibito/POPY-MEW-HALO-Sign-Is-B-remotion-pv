// Project-wide settings. Direction (what happens when) lives in direction.ts.

export const FPS = 30;
export const W = 1920;
export const H = 1080;

/** Composition time T = instrumental time + PRE.
 *  PRE = 2.298 s puts T on the reference video's clock (measured by aligning the SVP
 *  note onsets with the reference vocals), so T and the reference timecodes match 1:1. */
export const PRE = 2.298;
/** (v26, user: the dark opening was too long, viewers leave) the video starts SKIP seconds into the timeline.
 *  Every time in the code stays on the old clock T; frame 0 of the video is T = SKIP, so a timecode t of the
 *  rendered video is T = t + SKIP. Set 0 to get the old opening back. */
export const SKIP = 35 / 30; // = 1.167 s, a whole number of frames so the audio stays in sync
/** Composition length in seconds (instrumental is 221.87 s long), on the T clock (the video is DURATION - SKIP). */
export const DURATION = 224.2;

/** Audio used in the Studio preview and the render. Swap for your mix later
 *  (and set AUDIO_START to where time 0 of the instrumental sits in that file). */
export const AUDIO_FILE = 'audio/ref.m4a';
/** Second of the composition at which the audio file starts playing. */
export const AUDIO_AT = 0;

export type Member = 'popy' | 'mew' | 'halo';

/** SVP role (track) -> member of this cover. */
export const ROLE_TO_MEMBER: Record<string, Member> = {kana: 'popy', ruby: 'mew', mem: 'halo'};

export const NAMES: Record<Member, string> = {popy: 'POPY', mew: 'MEW', halo: 'HALO'};

/** Representative colours. main = blocks & silhouettes, deep = behind / around white text,
 *  light = bokeh & textures. Draft values: change here only. */
export const COLORS: Record<Member, {main: string; deep: string; light: string}> = {
  popy: {main: '#F2334F', deep: '#B8102E', light: '#FFB3BF'},
  mew: {main: '#8E5BEF', deep: '#5A2BB8', light: '#D7C4FF'},
  halo: {main: '#F0B323', deep: '#A06E00', light: '#FFE59A'},
};

export const FONT = '"MPR"';

/** STRONG EFFECTS (exceptions to the calm default; approved by the user 2026-10-31).
 *  1 = as designed, 0 = off. Each is limited to the sections listed in direction.ts. */
export const STRONG = {
  flash: 1, // white flashes at section heads
  strobe: 1, // penlight strobe cutting on eighth notes
  chroma: 1, // RGB split flicker on title hits
};
