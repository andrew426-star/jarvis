from app.core.config import get_settings
from app.core.groq_client import get_groq_client


def transcribe_audio(audio_bytes: bytes, filename: str, content_type: str) -> str:
    client = get_groq_client()
    settings = get_settings()

    transcription = client.audio.transcriptions.create(
        model=settings.groq_whisper_model,
        file=(filename, audio_bytes, content_type),
        response_format="text",
    )
    # response_format="text" returns a bare string, not the usual object —
    # the SDK still wraps it, so normalize to a plain str either way.
    return str(transcription).strip()
