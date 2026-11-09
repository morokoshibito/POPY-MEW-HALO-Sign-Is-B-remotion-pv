"""Shared helpers for reading a Synthesizer V project (.svp).

Time base: one quarter note = 705600000 blick. All output times are seconds
measured from the start of the instrumental track (its blickOffset = 0 s).
"""
import json
import re

BLICK_PER_BEAT = 705600000

# ---------------------------------------------------------------- loading

def load_svp(path):
    raw = open(path, "rb").read()
    txt = raw.decode("utf-8-sig", errors="replace").rstrip("\x00")
    return json.loads(txt)


class TempoMap:
    """blick -> seconds using the project's tempo table."""

    def __init__(self, svp):
        pts = sorted(svp["time"]["tempo"], key=lambda p: p["position"])
        self.pts = [(p["position"], p["bpm"]) for p in pts]
        # cumulative seconds at each tempo point
        self.cum = [0.0]
        for (p0, b0), (p1, _) in zip(self.pts, self.pts[1:]):
            self.cum.append(self.cum[-1] + (p1 - p0) / BLICK_PER_BEAT * 60.0 / b0)

    def sec(self, blick):
        i = 0
        while i + 1 < len(self.pts) and self.pts[i + 1][0] <= blick:
            i += 1
        p0, bpm = self.pts[i]
        return self.cum[i] + (blick - p0) / BLICK_PER_BEAT * 60.0 / bpm


def instrumental_offset_blick(svp):
    for t in svp["tracks"]:
        mr = t.get("mainRef", {})
        if mr.get("isInstrumental") and mr.get("audio"):
            return mr.get("blickOffset", 0), mr["audio"].get("filename", "")
    return 0, ""


def track_notes(svp, track):
    """All notes of a track (main group + referenced groups), absolute blick."""
    lib = {g["uuid"]: g for g in svp.get("library", [])}
    out = []
    mg = track.get("mainGroup", {})
    off = track.get("mainRef", {}).get("blickOffset", 0)
    for n in mg.get("notes", []):
        out.append((n["onset"] + off, n["duration"], n.get("lyrics", ""), n.get("pitch")))
    for ref in track.get("groups", []):
        g = lib.get(ref.get("groupID"))
        if not g:
            continue
        roff = ref.get("blickOffset", 0)
        for n in g.get("notes", []):
            out.append((n["onset"] + roff, n["duration"], n.get("lyrics", ""), n.get("pitch")))
    out.sort(key=lambda x: x[0])
    return out


# ---------------------------------------------------------------- kana

def kata_to_hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


_SMALL = set("ぁぃぅぇぉゃゅょゎ")


def split_kana(s):
    """Split a hiragana string into morae (small kana attach to the previous)."""
    out = []
    for c in s:
        if c in _SMALL and out:
            out[-1] += c
        else:
            out.append(c)
    return out


# Synthesizer V Japanese phoneme strings ('.k a sh') -> kana
_CONS = {
    "": {"a": "あ", "i": "い", "u": "う", "e": "え", "o": "お"},
    "k": dict(a="か", i="き", u="く", e="け", o="こ"),
    "g": dict(a="が", i="ぎ", u="ぐ", e="げ", o="ご"),
    "s": dict(a="さ", i="すぃ", u="す", e="せ", o="そ"),
    "sh": dict(a="しゃ", i="し", u="しゅ", e="しぇ", o="しょ"),
    "z": dict(a="ざ", i="ずぃ", u="ず", e="ぜ", o="ぞ"),
    "j": dict(a="じゃ", i="じ", u="じゅ", e="じぇ", o="じょ"),
    "t": dict(a="た", i="てぃ", u="とぅ", e="て", o="と"),
    "ch": dict(a="ちゃ", i="ち", u="ちゅ", e="ちぇ", o="ちょ"),
    "ts": dict(a="つぁ", i="つぃ", u="つ", e="つぇ", o="つぉ"),
    "d": dict(a="だ", i="でぃ", u="どぅ", e="で", o="ど"),
    "n": dict(a="な", i="に", u="ぬ", e="ね", o="の"),
    "h": dict(a="は", i="ひ", u="ふ", e="へ", o="ほ"),
    "f": dict(a="ふぁ", i="ふぃ", u="ふ", e="ふぇ", o="ふぉ"),
    "b": dict(a="ば", i="び", u="ぶ", e="べ", o="ぼ"),
    "p": dict(a="ぱ", i="ぴ", u="ぷ", e="ぺ", o="ぽ"),
    "m": dict(a="ま", i="み", u="む", e="め", o="も"),
    "y": dict(a="や", i="い", u="ゆ", e="いぇ", o="よ"),
    "r": dict(a="ら", i="り", u="る", e="れ", o="ろ"),
    "w": dict(a="わ", i="うぃ", u="う", e="うぇ", o="を"),
    "v": dict(a="ゔぁ", i="ゔぃ", u="ゔ", e="ゔぇ", o="ゔぉ"),
}
for c, row in [("ky", "き"), ("gy", "ぎ"), ("ny", "に"), ("hy", "ひ"), ("by", "び"),
               ("py", "ぴ"), ("my", "み"), ("ry", "り"), ("dy", "でぃ"), ("ty", "てぃ")]:
    _CONS[c] = dict(a=row + "ゃ", i=row, u=row + "ゅ", e=row + "ぇ", o=row + "ょ")
# consonant left without a vowel = devoiced mora
_DEVOICED = {"sh": "し", "ch": "ち", "j": "じ", "s": "す", "k": "く", "t": "つ",
             "ts": "つ", "h": "ふ", "f": "ふ", "p": "ぷ", "ky": "き", "py": "ぴ"}


def phonemes_to_kana(ph):
    toks = ph.split()
    out = []
    cons = ""
    for tk in toks:
        if tk in ("a", "i", "u", "e", "o"):
            out.append(_CONS.get(cons, _CONS[""]).get(tk, ""))
            cons = ""
        elif tk == "N":
            if cons:
                out.append(_DEVOICED.get(cons, ""))
                cons = ""
            out.append("ん")
        elif tk == "cl":
            if cons:
                out.append(_DEVOICED.get(cons, ""))
                cons = ""
            out.append("っ")
        elif tk in ("br", "sil", "pau"):
            cons = ""
        else:
            if cons:
                out.append(_DEVOICED.get(cons, ""))
            cons = tk
    if cons:
        out.append(_DEVOICED.get(cons, ""))
    return "".join(out)


EXTEND = {"-", "+", "ー"}


def note_kana(lyric):
    """Normalised kana for one SVP note. '' = no sound of its own (breath etc.).
    Returns None for an extension note ('-', '+')."""
    s = lyric.strip()
    if s in EXTEND:
        return None
    if s.startswith("."):
        s = phonemes_to_kana(s[1:])
    elif re.search(r"[A-Za-z]", s):
        # mixed kana + phonemes, e.g. 'とcl', 'に sh'
        s = s.replace("cl", " cl ")
        parts = []
        for tk in s.split():
            if re.fullmatch(r"[A-Za-z]+", tk):
                parts.append(phonemes_to_kana(tk))
            else:
                parts.append(tk)
        s = "".join(parts)
    s = s.replace("'", "")
    s = kata_to_hira(s)
    if re.fullmatch(r"br\w*|sil|pau", s or "x"):
        return ""
    return s


def normalise(s):
    """Kana used for matching: hiragana, を→お, づ→ず, ぢ→じ, drop っ and ー."""
    s = kata_to_hira(s)
    s = s.replace("を", "お").replace("づ", "ず").replace("ぢ", "じ")
    s = s.replace("っ", "").replace("ー", "")
    return s
