from fastapi import APIRouter, HTTPException, Response

from app.core.config import get_settings
from app.integrations.elevenlabs_api import text_to_speech
from app.schemas.speak import SpeakRequest

router = APIRouter()


# Sync (not async) on purpose — matches invoke.py: the httpx call here is
# synchronous, so a plain `def` route lets FastAPI run it in its
# threadpool rather than blocking the event loop.
@router.post("/speak")
def speak(request: SpeakRequest) -> Response:
    settings = get_settings()
    voice_id = request.voice_id or settings.elevenlabs_voice_id
    if not settings.elevenlabs_api_key or not voice_id:
        raise HTTPException(
            status_code=503,
            detail="ElevenLabs not configured — set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.",
        )

    try:
        audio = text_to_speech(
            request.text, voice_id, settings.elevenlabs_api_key, settings.elevenlabs_model_id
        )
    except Exception as exc:  # noqa: BLE001 — surface the real ElevenLabs error, don't swallow it
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return Response(content=audio, media_type="audio/mpeg")
