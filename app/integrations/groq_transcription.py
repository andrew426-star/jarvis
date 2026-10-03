import re

from app.core.config import get_settings
from app.core.groq_client import get_groq_client

# Whisper reads the prompt as "the text before this clip", which lets it
# spell the names Andrew uses ("Kivaro", not "Kevaro"). It must be names
# only: an earlier version held whole sentences ("I have class at
# Louisiana Tech"), and on an unclear clip Whisper wrote those back as if
# he had said them - "solve number five on the whiteboard" came out as
# having class. A bare list of names has no sentence to echo, and
# _echo() below catches it if it tries anyway.
VOCABULARY = "Jarvis, Kivaro, K.I.V., Louisiana Tech, OpenSCAD, Finnhub, Zoho."
_PROMPT_WORDS = set(re.findall(r"[a-z]+", VOCABULARY.lower()))

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


def _echo(text: str) -> bool:
    """The prompt coming back instead of speech: two or more words, nearly
    all of them from the vocabulary list."""
    words = re.findall(r"[a-z]+", text.lower())
    if len(words) < 2:
        return False
    return sum(word in _PROMPT_WORDS for word in words) / len(words) >= 0.6


def transcribe_audio(audio_bytes: bytes, filename: str, content_type: str) -> str:
    text = _transcribe(audio_bytes, filename, content_type, VOCABULARY)
    # Heard the prompt rather than him: once more, with nothing to echo.
    if _echo(text):
        text = _transcribe(audio_bytes, filename, content_type, None)
    return text


def _transcribe(audio_bytes: bytes, filename: str, content_type: str, prompt: str | None) -> str:
    client = get_groq_client()
    settings = get_settings()

    options = {"prompt": prompt} if prompt else {}
    transcription = client.audio.transcriptions.create(
        model=settings.groq_whisper_model,
        file=(filename, audio_bytes, content_type),
        # Pinned: on a short or muffled clip, auto-detect sometimes decides
        # it heard another language and transcribes (or translates) as one.
        language="en",
        temperature=0,
        # Per-segment confidence, so silence can be told from speech.
        response_format="verbose_json",
        **options,
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
