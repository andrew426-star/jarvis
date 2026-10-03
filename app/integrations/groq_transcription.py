import re

from app.core.config import get_settings
from app.core.groq_client import get_groq_client

# Whisper hears better when told what it is likely to hear. The prompt is
# read as "the text before this clip", so it carries the names Andrew says
# that Whisper would otherwise spell as common words ("Kevaro", "Jervis").
# Kept short: a long prompt is sometimes echoed back on a quiet clip.
VOCABULARY = (
    "Jarvis, open the workshop. Check Kivaro AI's pipeline and my K.I.V. tasks. "
    "I have class at Louisiana Tech. Alpaca, Finnhub, Stripe, Zoho, Gemini, OpenSCAD."
)

# Whisper's own rule for "this segment was silence": likely no speech, and
# not confident in the words it produced anyway.
NO_SPEECH_PROB = 0.6
LOW_LOGPROB = -1.0

# What Whisper writes for room noise, a breath or a cough. Dropped only
# when the clip says nothing else and Whisper itself doubted there was
# speech, so a real "thank you" still goes through.
HALLUCINATIONS = re.compile(
    r"^\W*(thank you( very much)?|thanks( for watching)?|bye|you|uh|um|okay|"
    r"please subscribe.*|subtitles by.*)\W*$",
    re.IGNORECASE,
)


def transcribe_audio(audio_bytes: bytes, filename: str, content_type: str) -> str:
    client = get_groq_client()
    settings = get_settings()

    transcription = client.audio.transcriptions.create(
        model=settings.groq_whisper_model,
        file=(filename, audio_bytes, content_type),
        # Pinned: on a short or muffled clip, auto-detect sometimes decides
        # it heard another language and transcribes (or translates) as one.
        language="en",
        temperature=0,
        prompt=VOCABULARY,
        # Per-segment confidence, so silence can be told from speech.
        response_format="verbose_json",
    )
    data = transcription.model_dump() if hasattr(transcription, "model_dump") else {}
    segments = data.get("segments") or []
    if not segments:
        return str(data.get("text") or getattr(transcription, "text", "") or "").strip()

    kept = [
        s for s in segments
        if not (
            (s.get("no_speech_prob") or 0) > NO_SPEECH_PROB
            and (s.get("avg_logprob") or 0) < LOW_LOGPROB
        )
    ]
    text = " ".join((s.get("text") or "").strip() for s in kept).strip()
    doubtful = all((s.get("no_speech_prob") or 0) > 0.3 for s in kept)
    if doubtful and HALLUCINATIONS.match(text):
        return ""
    return text
