import re
from collections import Counter

# Measured, not guessed: every number here comes from the transcript text
# (and the talk's length, when known). Jarvis turns the numbers into
# coaching; the tool never invents a score.

FILLERS = ["um", "uh", "er", "like", "you know", "basically", "actually", "literally", "i mean", "kind of", "sort of"]
HEDGES = ["i think", "i guess", "maybe", "probably", "just", "i feel like", "hopefully", "a little bit"]

# Comfortable range for a pitch or presentation. Conversation runs faster.
TARGET_WPM = (130, 160)
MAX_FILLERS_PER_100 = 3.0
MAX_AVG_SENTENCE_WORDS = 22


def _count_phrases(text: str, phrases: list[str]) -> dict[str, int]:
    counts = {}
    for phrase in phrases:
        n = len(re.findall(rf"\b{re.escape(phrase)}\b", text))
        if n:
            counts[phrase] = n
    return counts


def analyze(transcript: str, duration_seconds: float | None = None) -> dict:
    lowered = transcript.lower()
    words = re.findall(r"[a-zA-Z']+", lowered)
    word_count = len(words)
    if word_count == 0:
        return {"ok": False, "error": "Transcript is empty."}

    sentences = [s for s in re.split(r"[.!?]+", transcript) if s.strip()]
    sentence_lengths = [len(re.findall(r"[a-zA-Z']+", s)) for s in sentences]
    fillers = _count_phrases(lowered, FILLERS)
    hedges = _count_phrases(lowered, HEDGES)
    filler_total = sum(fillers.values())
    fillers_per_100 = round(filler_total / word_count * 100, 1)
    avg_sentence = round(sum(sentence_lengths) / len(sentence_lengths), 1) if sentence_lengths else float(word_count)
    openers = Counter(s.strip().split()[0].lower().strip(",") for s in sentences if s.strip().split())
    repeated_openers = {w: n for w, n in openers.most_common(3) if n >= 3}
    content_words = [w for w in words if len(w) > 3]
    wpm = round(word_count / (duration_seconds / 60)) if duration_seconds and duration_seconds > 0 else None

    focus: list[str] = []
    if wpm is not None and wpm > TARGET_WPM[1]:
        focus.append(f"Slow down: {wpm} words per minute against a {TARGET_WPM[0]}-{TARGET_WPM[1]} target. Pause at each full stop.")
    elif wpm is not None and wpm < TARGET_WPM[0] - 20:
        focus.append(f"Pick up the pace: {wpm} words per minute. Rehearse the opening until it flows.")
    if fillers_per_100 > MAX_FILLERS_PER_100:
        top = max(fillers, key=fillers.get)
        focus.append(f"Cut fillers: {filler_total} in {word_count} words, mostly \"{top}\". Replace each with a silent pause.")
    if avg_sentence > MAX_AVG_SENTENCE_WORDS:
        focus.append(f"Shorten sentences: averaging {avg_sentence} words. Aim for under {MAX_AVG_SENTENCE_WORDS}; one idea per sentence.")
    if sum(hedges.values()) >= 3:
        focus.append(f"Drop the hedges ({', '.join(hedges)}). State the claim, then back it with a number.")
    if repeated_openers:
        w = next(iter(repeated_openers))
        focus.append(f"Vary your openers: {repeated_openers[w]} sentences start with \"{w}\".")
    if not focus:
        focus.append("Clean delivery on the measurable basics. Next: a stronger first sentence and a sharper close.")

    return {
        "ok": True,
        "words": word_count,
        "duration_seconds": duration_seconds,
        "words_per_minute": wpm,
        "target_wpm": list(TARGET_WPM),
        "fillers": fillers,
        "fillers_per_100_words": fillers_per_100,
        "hedges": hedges,
        "sentences": len(sentences),
        "avg_sentence_words": avg_sentence,
        "longest_sentence_words": max(sentence_lengths) if sentence_lengths else word_count,
        "vocabulary_range": round(len(set(content_words)) / len(content_words), 2) if content_words else None,
        "repeated_openers": repeated_openers,
        "focus": focus[:2],
        "caveat": (
            "Speech-to-text often drops 'um' and 'uh', so real filler counts can be higher than "
            "shown. Pace is only measured when the talk's length is given."
        ),
    }


def speech_coach(args: dict) -> dict:
    transcript = args.get("transcript")
    if not isinstance(transcript, str) or not transcript.strip():
        return {"ok": False, "error": "transcript is required"}
    duration = args.get("duration_seconds")
    duration = float(duration) if isinstance(duration, (int, float)) and duration > 0 else None
    return analyze(transcript, duration)
