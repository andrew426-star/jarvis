from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.auth import require_access_token
from app.integrations.groq_transcription import transcribe_audio

router = APIRouter()


@router.post("/transcribe", dependencies=[Depends(require_access_token)])
async def transcribe(file: UploadFile = File(...)) -> dict:
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="Empty audio file.")

    try:
        text = transcribe_audio(audio_bytes, file.filename or "audio.webm", file.content_type or "audio/webm")
    except Exception as exc:  # noqa: BLE001 — surface the real Groq error, don't swallow it
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"text": text}
