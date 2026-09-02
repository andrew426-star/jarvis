from fastapi import APIRouter, Depends, HTTPException, Response

from app.core.auth import require_access_token
from app.core.config import get_settings
from app.integrations.fish_audio import text_to_speech
from app.schemas.speak import SpeakRequest

router = APIRouter()


# Sync (not async) on purpose — matches invoke.py: the httpx call here is
# synchronous, so a plain `def` route lets FastAPI run it in its
# threadpool rather than blocking the event loop.
@router.post("/speak", dependencies=[Depends(require_access_token)])
def speak(request: SpeakRequest) -> Response:
    settings = get_settings()
    voice_id = request.voice_id or settings.fish_audio_voice_id
    if not settings.fish_audio_api_key or not voice_id:
        raise HTTPException(
            status_code=503,
            detail=(
            "Voice is not configured — set FISH_AUDIO_API_KEY and FISH_AUDIO_VOICE_ID. "
            "The voice ID is Fish Audio's reference_id."
        ),
        )

    try:
        audio = text_to_speech(
            request.text, voice_id, settings.fish_audio_api_key, settings.fish_audio_model
        )
    except Exception as exc:  # noqa: BLE001 — surface the real Fish Audio error, don't swallow it
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return Response(content=audio, media_type="audio/mpeg")
