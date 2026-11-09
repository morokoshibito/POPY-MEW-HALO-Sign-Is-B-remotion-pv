"""Align lyrics.txt to the notes of a Synthesizer V project.

Usage:
  python align_lyrics.py <project.svp> <lyrics.txt> <out lyrics.json> [config.json]

Outputs
  lyrics.json          phrases[] with per-token times and singers
  timing_report.txt    next to lyrics.txt: one line per character
  parts_report.txt     next to lyrics.txt: who sings each phrase

Times are seconds from the start of the instrumental track.
Singers come from the track a note sits on (track name -> singer id in config).
"""
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svp_common import (TempoMap, instrumental_offset_blick, kata_to_hira, load_svp,
                        normalise, note_kana, split_kana, track_notes)

DEFAULT_CONFIG = {
    # track name -> singer id. Tracks not listed here are ignored.
    "main_tracks": {"Vox (Arima)": "kana", "Vox (Ruby)": "ruby", "Vox (MEM)": "mem"},
    # tracks that carry the call-and-response lines in ( ... )
    "call_tracks": ["Cheer (Arima)"],
    # which voice sings each role in this cover
    "cast": {"kana": "POPY", "ruby": "MEW", "mem": "HALO"},
}

SIMILAR = [("は", "わ"), ("お", "を"), ("ず", "づ"), ("じ", "ぢ"), ("え", "へ"), ("し", "じ"),
           ("て", "で"), ("か", "が"), ("ば", "ぱ"), ("ふ", "ほ")]
SIM = {frozenset(p) for p in SIMILAR}
PUNCT = set("、。，,.！？!?・…▽♡「」『』〜~")
SMALL = set("ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ")
HOLD = set("っッーｰ")  # take the previous character's end


# ------------------------------------------------------------------ lyrics

def read_text(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "utf-16", "cp932", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"[lyrics] cannot decode {path}")


def is_base(c):
    return bool(re.match(r"[一-鿿㐀-䶿々〆0-9A-Za-z０-９Ａ-Ｚａ-ｚ]", c))


def tokens_from(text):
    """Split display text (ruby already resolved as (base, reading) pairs) into tokens."""
    toks = []
    for base, reading in text:
        if reading is not None:
            toks.append({"s": base, "r": kata_to_hira(reading)})
            continue
        for c in base:
            h = kata_to_hira(c)
            if c in SMALL and toks and toks[-1]["r"]:
                toks[-1]["r"] += h
                toks.append({"s": c, "r": "", "attach": "start"})
            elif c in HOLD:
                toks.append({"s": c, "r": "", "attach": "end"})
            elif c in PUNCT or not re.match(r"[぀-ゟ]", h):
                toks.append({"s": c, "r": "", "attach": "start"})
            else:
                toks.append({"s": c, "r": h})
    return toks


def parse_runs(s, ruby_open="(", ruby_close=")"):
    """Turn '会(あ)えた' into [('会','あ'), ('えた', None)]. Returns list of runs."""
    runs = []
    buf = ""
    i = 0
    while i < len(s):
        c = s[i]
        if c == ruby_open:
            j = s.index(ruby_close, i)
            reading = s[i + 1:j]
            k = len(buf)
            while k > 0 and is_base(buf[k - 1]):
                k -= 1
            if buf[:k]:
                runs.append((buf[:k], None))
            runs.append((buf[k:], reading))
            buf = ""
            i = j + 1
            continue
        buf += c
        i += 1
    if buf:
        runs.append((buf, None))
    return runs


def split_phrases(runs):
    """Split runs on spaces into phrases (each a list of runs)."""
    phrases, cur = [], []
    for base, reading in runs:
        if reading is not None:
            cur.append((base, reading))
            continue
        parts = re.split(r"[ 　]+", base)
        for n, p in enumerate(parts):
            if n > 0:
                if cur:
                    phrases.append(cur)
                cur = []
            if p:
                cur.append((p, None))
    if cur:
        phrases.append(cur)
    return phrases


def parse_lyrics(path):
    lines = []
    for raw in read_text(path).splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    print(f"[lyrics] read {len(lines)} lines from {os.path.abspath(path)}")
    if not lines:
        raise SystemExit("[lyrics] 0 lines: is the file saved?")
    phrases = []
    for ln, line in enumerate(lines, start=1):
        # cut into main text and call groups: '(' not right after a base char opens a call
        segs, buf, i = [], "", 0
        while i < len(line):
            c = line[i]
            if c == "(" and not (buf and is_base(buf[-1])):
                j = line.index(")", i)
                if buf:
                    segs.append((buf, False))
                    buf = ""
                segs.append((line[i + 1:j], True))
                i = j + 1
                continue
            if c == "(":  # ruby: copy through
                j = line.index(")", i)
                buf += line[i:j + 1]
                i = j + 1
                continue
            buf += c
            i += 1
        if buf:
            segs.append((buf, False))
        idx = 0
        for text, whisper in segs:
            runs = parse_runs(text, "{", "}") if whisper else parse_runs(text)
            for ph in split_phrases(runs):
                toks = tokens_from(ph)
                phrases.append({
                    "id": f"L{ln}P{idx}", "line": ln, "idx": idx, "whisper": whisper,
                    "text": "".join(t["s"] for t in toks), "tokens": toks,
                })
                idx += 1
    return phrases


# ------------------------------------------------------------------ notes

def collect_notes(svp, names, tm, t0):
    """Notes of the named tracks merged into one list of morae.
    Identical notes on several tracks become one mora carrying every track."""
    raw = []
    for tr in svp["tracks"]:
        if tr["name"] not in names:
            continue
        for on, du, ly, _ in track_notes(svp, tr):
            raw.append((tm.sec(on) - t0, tm.sec(on + du) - t0, note_kana(ly), tr["name"]))
    raw.sort(key=lambda x: (x[0], x[3]))
    # extension notes lengthen the previous note of the same track
    last = {}
    notes = []
    for s, e, k, name in raw:
        if k is None:
            # an extension only lengthens a note it touches
            if name in last and s - last[name]["e"] < 0.05:
                last[name]["e"] = max(last[name]["e"], e)
            continue
        n = {"s": s, "e": e, "k": normalise(k), "tracks": {name}}
        notes.append(n)
        last[name] = n
    # merge identical notes across tracks
    merged = []
    for n in notes:
        hit = None
        for m in reversed(merged[-6:]):
            if abs(m["s"] - n["s"]) < 0.003 and m["k"] == n["k"]:
                hit = m
                break
        if hit:
            hit["tracks"] |= n["tracks"]
            hit["e"] = max(hit["e"], n["e"])
        else:
            merged.append(n)
    # split into morae; breath / empty notes dropped
    morae = []
    for n in merged:
        ks = split_kana(n["k"])
        if not ks:
            continue
        d = (n["e"] - n["s"]) / len(ks)
        for i, k in enumerate(ks):
            morae.append({"s": n["s"] + i * d, "e": n["s"] + (i + 1) * d, "k": k,
                          "tracks": n["tracks"], "note_s": n["s"]})
    return morae


# ------------------------------------------------------------------ alignment

def score(a, b):
    if a == b:
        return 3
    if frozenset((a[:1], b[:1])) in SIM and a[1:] == b[1:]:
        return 1
    if len(a) > 1 and len(b) > 1 and a[0] == b[0]:
        return 1  # same consonant row, different small kana (ちゃ / ちゅ)
    if plain(a) == plain(b):
        return 1  # voiced / unvoiced (ぶ / ぷ / ふ)
    return -2


def plain(k):
    return "".join(c for c in unicodedata.normalize("NFD", k) if c not in "\u3099\u309a")


def nw(lyr, nts, note_gap):
    """Needleman-Wunsch. lyr, nts: lists of kana. Returns pairs (i, j) aligned."""
    n, m = len(lyr), len(nts)
    G = -1.0
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    P = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        S[i][0] = S[i - 1][0] + G
        P[i][0] = 1
    for j in range(1, m + 1):
        S[0][j] = 0.0  # free leading note skips
        P[0][j] = 2
    for i in range(1, n + 1):
        Si, Sp, Pi, a = S[i], S[i - 1], P[i], lyr[i - 1]
        for j in range(1, m + 1):
            d = Sp[j - 1] + score(a, nts[j - 1])
            u = Sp[j] + G
            l = Si[j - 1] + note_gap
            if d >= u and d >= l:
                Si[j], Pi[j] = d, 0
            elif u >= l:
                Si[j], Pi[j] = u, 1
            else:
                Si[j], Pi[j] = l, 2
    pairs = []
    # free trailing note skips: end at the best column (earliest on ties)
    best = max(range(m + 1), key=lambda c: (S[n][c], -c))
    i, j = n, best
    while i > 0 or j > 0:
        p = P[i][j] if i > 0 and j > 0 else (1 if i > 0 else 2)
        if p == 0:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif p == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def align(units, morae, note_gap):
    """units: list of kana (lyric morae). morae: candidate note morae.
    Returns per unit (mora index or None, source)."""
    lyr = [u for u in units]
    nts = [m["k"] for m in morae]
    pairs = nw(lyr, nts, note_gap)
    res = [None] * len(lyr)
    used = set()
    last_j = max([j for _, j in pairs] + [-1])
    for i, j in pairs:
        if score(lyr[i], nts[j]) > 0:
            res[i] = (j, "match")
            used.add(j)
    # fill gaps: unmatched units go onto free notes between the anchors
    i = 0
    while i < len(lyr):
        if res[i] is not None:
            i += 1
            continue
        k = i
        while k < len(lyr) and res[k] is None:
            k += 1
        lo = res[i - 1][0] if i > 0 else None
        hi = res[k][0] if k < len(lyr) else None
        if lo is None and hi is None:
            lo, hi = -1, min(len(nts), k - i)
        elif lo is None:
            lo = max(-1, hi - 1 - (k - i))
        elif hi is None:
            hi = min(len(nts), lo + 1 + (k - i))
        free = [j for j in range(lo + 1, hi) if j not in used]
        cnt = k - i
        if free:
            for q in range(cnt):
                j = free[min(len(free) - 1, q * len(free) // cnt)]
                res[i + q] = (j, "gap")
                used.add(j)
        else:
            for q in range(cnt):
                res[i + q] = (None, "interp", lo, hi, q, cnt)
        i = k
    nmatch = sum(1 for r in res if r and r[1] == "match")
    return res, used, nmatch


def refine(res, used, units, owner, morae):
    """Two fixes on top of the global alignment.
    1. A mora sung by a different track than its neighbours in the same phrase moves to an
       unused note with the same kana within 0.3 s on the neighbours' track (tie-break of
       identical kana on parallel tracks).
    2. A mora with no free note left shares the start of an adjacent anchor in the same
       phrase (same token first, then the previous one, then the next) instead of being
       interpolated."""
    n = len(units)

    def tracks_of(i):
        r = res[i]
        return morae[r[0]]["tracks"] if r and r[0] is not None else set()

    for i in range(n):
        r = res[i]
        if not r or r[0] is None:
            continue
        nb = set()
        for d in (-1, 1):
            k = i + d
            if 0 <= k < n and owner[k][0] == owner[i][0]:
                nb |= tracks_of(k)
        if not nb or tracks_of(i) & nb:
            continue
        t = morae[r[0]]["s"]
        best = None
        for j, m in enumerate(morae):
            if j in used or abs(m["s"] - t) > 0.3 or not (m["tracks"] & nb):
                continue
            if score(units[i], m["k"]) <= 0:
                continue
            if best is None or abs(m["s"] - t) < abs(morae[best]["s"] - t):
                best = j
        if best is not None:
            used.discard(r[0])
            used.add(best)
            res[i] = (best, r[1])

    # a phrase that starts on a repeated pickup note (e.g. 'い + い) starts at the first one
    for i in range(n):
        if i > 0 and owner[i - 1][0] == owner[i][0]:
            continue
        r = res[i]
        if not r or r[0] is None or r[0] == 0:
            continue
        j = r[0]
        p = morae[j - 1]
        if (j - 1) not in used and p["k"] == morae[j]["k"] and p["tracks"] & morae[j]["tracks"] \
                and morae[j]["s"] - p["e"] < 0.05:
            used.add(j - 1)
            res[i] = (j - 1, r[1])

    for i in range(n):
        r = res[i]
        if not r or r[0] is not None:
            continue
        pi, ti = owner[i]
        cands = []
        for k in list(range(i - 1, -1, -1)) + list(range(i + 1, n)):
            if owner[k][0] != pi:
                continue
            rk = res[k]
            if rk and rk[0] is not None:
                same_tok = owner[k][1] == ti
                cands.append((0 if same_tok else (1 if k < i else 2), abs(k - i), rk[0]))
        if cands:
            cands.sort()
            res[i] = (cands[0][2], "share")


# ------------------------------------------------------------------ main

def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    svp_path, lyr_path, out_path = sys.argv[1:4]
    cfg = dict(DEFAULT_CONFIG)
    if len(sys.argv) > 4:
        cfg.update(json.load(open(sys.argv[4], encoding="utf-8")))

    svp = load_svp(svp_path)
    tm = TempoMap(svp)
    inst_blick, inst_file = instrumental_offset_blick(svp)
    t0 = tm.sec(inst_blick)
    names = [t["name"] for t in svp["tracks"]]
    print(f"[svp] tracks: {names}")
    print(f"[svp] instrumental '{inst_file}' starts at {t0:.4f} s of the project -> time 0")
    main_names = [n for n in cfg["main_tracks"] if n in names]
    call_names = [n for n in cfg["call_tracks"] if n in names]
    missing = [n for n in cfg["main_tracks"] if n not in names]
    if missing:
        print(f"[svp] WARNING main tracks not found: {missing}")
    print(f"[svp] main tracks used: {main_names}; call tracks: {call_names}")

    phrases = parse_lyrics(lyr_path)
    main_morae = collect_notes(svp, set(main_names), tm, t0)
    call_morae = collect_notes(svp, set(call_names) | set(main_names), tm, t0)

    # ---- main phrases against the main tracks
    units, owner = [], []
    for pi, ph in enumerate(phrases):
        if ph["whisper"]:
            continue
        for ti, tk in enumerate(ph["tokens"]):
            for k in split_kana(normalise(tk["r"])):
                units.append(k)
                owner.append((pi, ti))
    res, used_main, _ = align(units, main_morae, note_gap=-0.5)
    refine(res, used_main, units, owner, main_morae)

    def unit_time(r, morae):
        if r[0] is not None:
            m = morae[r[0]]
            if r[1] == "share":
                return m["s"], m["s"], m["tracks"], ""
            return m["s"], m["e"], m["tracks"], m["k"]
        _, _, lo, hi, q, cnt = r
        a = morae[lo]["e"] if lo >= 0 else 0.0
        b = morae[hi]["s"] if hi < len(morae) else a + 1.0
        s = a + (b - a) * q / cnt
        return s, s + (b - a) / cnt, set(), ""

    tok_units = {}
    for (pi, ti), r in zip(owner, res):
        s, e, trs, k = unit_time(r, main_morae)
        tok_units.setdefault((pi, ti), []).append((s, e, trs, r[1], k))

    # ---- call phrases: notes of the call tracks (and unused main notes) near their line
    main_by_line = {}
    for pi, ph in enumerate(phrases):
        if not ph["whisper"]:
            main_by_line.setdefault(ph["line"], []).append(pi)

    def main_span(pi):
        ts = [u[0] for ti in range(len(phrases[pi]["tokens"])) for u in tok_units.get((pi, ti), [])]
        te = [u[1] for ti in range(len(phrases[pi]["tokens"])) for u in tok_units.get((pi, ti), [])]
        return (min(ts), max(te)) if ts else None

    cursor = -1e9
    main_used_starts = {round(main_morae[j]["s"], 4) for j in used_main}
    call_set, main_set = set(call_names), set(main_names)
    for pi, ph in enumerate(phrases):
        if not ph["whisper"]:
            continue
        ln = ph["line"]
        same_line = [q for q in main_by_line.get(ln, []) if q < pi]
        if ln in main_by_line:
            lo = main_span(main_by_line[ln][0])[0] - 1.0
        else:
            prev = [q for q in range(pi) if not phrases[q]["whisper"]]
            lo = main_span(prev[-1])[1] if prev else 0.0
        nxt = [q for q in range(pi + 1, len(phrases)) if not phrases[q]["whisper"] and phrases[q]["line"] > ln]
        hi = (main_span(nxt[0])[1] + 1.0) if nxt else 1e9
        lo = max(lo, cursor)
        # main-track notes are only candidates after the main text before this call
        main_lo = max(lo, main_span(same_line[-1])[1] - 0.05) if same_line else lo
        cand_call = [m for m in call_morae if lo <= m["s"] <= hi and m["tracks"] & call_set]
        cand_main = [m for m in call_morae if main_lo <= m["s"] <= hi and not (m["tracks"] & call_set)
                     and round(m["s"], 4) not in main_used_starts]
        u2, o2 = [], []
        for ti, tk in enumerate(ph["tokens"]):
            for k in split_kana(normalise(tk["r"])):
                u2.append(k)
                o2.append(ti)
        if not u2:
            continue
        best = None
        for cand in (cand_call, cand_main):
            if not cand:
                continue
            r2, _, nm = align(u2, cand, note_gap=-0.3)
            if best is None or nm > best[0]:
                best = (nm, r2, cand)
        if best is None:
            continue
        _, r2, cand = best
        last_e = cursor
        for ti, r in zip(o2, r2):
            s, e, trs, k = unit_time(r, cand)
            tok_units.setdefault((pi, ti), []).append((s, e, trs, r[1], k))
            last_e = max(last_e, s)
        cursor = last_e + 0.01

    # ---- token times
    total = matched = 0
    report = []
    track_to_singer = cfg["main_tracks"]
    roles = list(track_to_singer.values()) + ["call"]

    def order(x):
        return roles.index(x) if x in roles else len(roles)
    for pi, ph in enumerate(phrases):
        prev_t0 = prev_t1 = None
        tally = {}
        nunits = 0
        for ti, tk in enumerate(ph["tokens"]):
            us = tok_units.get((pi, ti))
            if us:
                tk["t0"] = round(min(u[0] for u in us), 3)
                tk["t1"] = round(max(u[1] for u in us), 3)
                srcs = [u[3] for u in us]
                tk["src"] = "match" if all(x == "match" for x in srcs) else next(
                    x for x in ("interp", "share", "gap") if x in srcs)
                tk["svp"] = "".join(u[4] for u in us)
                who = set()
                for u in us:
                    for t in u[2]:
                        who.add(track_to_singer.get(t, "call"))
                tk["who"] = sorted(who, key=order) or None
                for u in us:
                    total += 1
                    matched += u[3] == "match"
                    nunits += 1
                    for t in u[2]:
                        if t in track_to_singer:
                            tally[track_to_singer[t]] = tally.get(track_to_singer[t], 0) + 1
            else:
                if tk.get("attach") == "end" and prev_t1 is not None:
                    tk["t0"] = tk["t1"] = prev_t1
                elif prev_t0 is not None:
                    tk["t0"] = tk["t1"] = prev_t0
                else:
                    tk["t0"] = tk["t1"] = None
                tk["src"] = "punct"
                tk["svp"] = ""
                tk["who"] = None
            if tk["t0"] is not None and tk["src"] != "punct":
                prev_t0, prev_t1 = tk["t0"], tk["t1"]
        # leading punctuation (e.g. 「) takes the first sung character
        first = next((t["t0"] for t in ph["tokens"] if t["t0"] is not None), None)
        for t in ph["tokens"]:
            if t["t0"] is None:
                t["t0"] = t["t1"] = first
        ts = [t["t0"] for t in ph["tokens"] if t["t0"] is not None]
        te = [t["t1"] for t in ph["tokens"] if t["t1"] is not None]
        ph["start"] = min(ts) if ts else None
        ph["end"] = max(te) if te else None
        # punctuation inherits the singer of the character before it (or after it)
        last_who = None
        for t in ph["tokens"]:
            if t["who"] is None:
                t["who"] = last_who
            last_who = t["who"]
        nxt_who = None
        for t in reversed(ph["tokens"]):
            if t["who"] is None:
                t["who"] = nxt_who
            nxt_who = t["who"]
        segs = []
        for ti, t in enumerate(ph["tokens"]):
            w = t["who"] or []
            if segs and segs[-1]["singers"] == w:
                segs[-1]["to"] = ti
            else:
                segs.append({"from": ti, "to": ti, "singers": w})
        ph["segments"] = segs
        allw = set(w for t in ph["tokens"] for w in (t["who"] or []))
        ph["singers"] = sorted(allw, key=order)
        for ti, tk in enumerate(ph["tokens"]):
            report.append(f"@{len(report):04d} {ph['id']:7s} {tk['s']} "
                          f"{tk['t0'] if tk['t0'] is not None else '-':>8} {tk['src']:6s} svp:'{tk['svp']}'")

    rate = matched / max(1, total)
    print(f"[align] matched {matched}/{total} morae = {rate * 100:.1f}%")
    if total == 0:
        raise SystemExit("[align] nothing matched: check lyrics.txt and the track names")

    out = {
        "meta": {
            "source": os.path.basename(svp_path),
            "time_zero": "instrumental start",
            "instrumental": inst_file,
            "instrumental_offset_in_project_s": round(t0, 6),
            "tempo": svp["time"]["tempo"],
            "cast": cfg["cast"],
            "match_rate": round(rate, 4),
        },
        "phrases": [
            {k: ph[k] for k in ("id", "line", "idx", "whisper", "start", "end", "text", "singers", "segments")}
            | {"tokens": [{k: t[k] for k in ("s", "r", "t0", "t1", "src", "who")} for t in ph["tokens"]]}
            for ph in phrases
        ],
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    base = os.path.dirname(os.path.abspath(lyr_path))
    open(os.path.join(base, "timing_report.txt"), "w", encoding="utf-8").write("\n".join(report) + "\n")
    parts = []
    for ph in phrases:
        st = f"{ph['start']:.2f}" if ph["start"] is not None else "-"
        en = f"{ph['end']:.2f}" if ph["end"] is not None else "-"
        segtxt = " | ".join(
            "+".join(cfg["cast"].get(w, w) for w in sg["singers"]) + ":" +
            "".join(t["s"] for t in ph["tokens"][sg["from"]:sg["to"] + 1]) for sg in ph["segments"])
        parts.append(f"{ph['id']:7s} {st:>7}-{en:<7} {segtxt}")
    open(os.path.join(base, "parts_report.txt"), "w", encoding="utf-8").write("\n".join(parts) + "\n")
    print(f"[out] {out_path}")
    print(f"[out] {os.path.join(base, 'timing_report.txt')}")
    print(f"[out] {os.path.join(base, 'parts_report.txt')}")


if __name__ == "__main__":
    main()
