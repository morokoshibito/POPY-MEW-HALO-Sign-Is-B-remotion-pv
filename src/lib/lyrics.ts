import data from '../data/lyrics.json';
import {Member, PRE, ROLE_TO_MEMBER} from '../config';

// lyrics.json is produced by scripts/align_lyrics.py from the SVP project.
// All times here are converted to composition time (T = instrumental time + PRE).

export type Tok = {s: string; t0: number; t1: number; who: Member[]};
export type Phrase = {
  id: string;
  line: number;
  whisper: boolean;
  start: number;
  end: number;
  text: string;
  singers: Member[];
  toks: Tok[];
};

type RawTok = {s: string; r: string; t0: number | null; t1: number | null; src: string; who: string[] | null};
type RawPhrase = {
  id: string;
  line: number;
  idx: number;
  whisper: boolean;
  start: number | null;
  end: number | null;
  text: string;
  singers: string[];
  tokens: RawTok[];
};

/** Characters shown differently from the lyric file. One line to revert: remove the entry. */
const DISPLAY: Record<string, string> = {'▽': '♡'};

const toMembers = (w: string[] | null | undefined): Member[] =>
  (w ?? []).map((r) => ROLE_TO_MEMBER[r]).filter((m): m is Member => !!m);

/** Marks with no note of their own (long vowel, small tsu) appear just after the previous
 *  character instead of at the end of its note, so they never lag behind a cut. */
const HOLD = /^[ーｰ〜～っッ]$/;
const settle = (toks: Tok[]): Tok[] =>
  toks.map((t, i) => (i > 0 && HOLD.test(t.s) && t.t0 > toks[i - 1].t0 + 0.06 ? {...t, t0: toks[i - 1].t0 + 0.06} : t));

export const PHRASES: Phrase[] = (data.phrases as RawPhrase[]).map((p) => ({
  id: p.id,
  line: p.line,
  whisper: p.whisper,
  start: (p.start ?? 0) + PRE,
  end: (p.end ?? 0) + PRE,
  text: p.text,
  singers: toMembers(p.singers),
  toks: settle(
    p.tokens.map((t) => ({
      s: DISPLAY[t.s] ?? t.s,
      t0: (t.t0 ?? p.start ?? 0) + PRE,
      t1: (t.t1 ?? t.t0 ?? p.end ?? 0) + PRE,
      who: toMembers(t.who),
    })),
  ),
}));

const BY_ID = new Map(PHRASES.map((p) => [p.id, p]));

export const P = (id: string): Phrase => {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`phrase ${id} not found in lyrics.json`);
  return p;
};

/** A run of characters sung by the same set of members. */
export type Seg = {who: Member[]; toks: Tok[]; start: number; end: number; text: string};

/** Split phrases into runs of the same singers (a line can change singer mid-way). */
export const segments = (ids: string[]): Seg[] => {
  const out: Seg[] = [];
  for (const id of ids) {
    const p = P(id);
    let cur: Seg | null = null;
    for (const t of p.toks) {
      const key = t.who.join('+');
      if (cur && t.who.length === 0) {
        cur.toks.push(t);
        cur.text += t.s;
        continue;
      }
      if (!cur || cur.who.join('+') !== key) {
        cur = {who: t.who, toks: [], start: t.t0, end: t.t1, text: ''};
        out.push(cur);
      }
      cur.toks.push(t);
      cur.end = Math.max(cur.end, t.t1);
      cur.text += t.s;
    }
  }
  return out;
};

/** Like segments(), but consecutive runs of the same singers are merged across phrases. */
export const runs = (ids: string[]): Seg[] => {
  const out: Seg[] = [];
  for (const s of segments(ids)) {
    const last = out[out.length - 1];
    if (last && last.who.join('+') === s.who.join('+')) {
      last.toks.push({s: '\u3000', t0: s.start, t1: s.start, who: s.who}, ...s.toks);
      last.end = Math.max(last.end, s.end);
      last.text += s.text;
    } else out.push({...s, toks: [...s.toks]});
  }
  return out;
};
