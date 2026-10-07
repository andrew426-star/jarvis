import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.integrations.fish_audio import text_to_speech
from app.services.devices import avatar_state, file_event, take_speech

# The workshop's ESP32 builds talking to Jarvis (app/services/devices.py).
# They hold JARVIS_DEVICE_TOKEN, which opens these routes and nothing else:
# a device can file an alert and read what Jarvis last said, never act as
# Andrew. Unset, every device route refuses (fails closed, like the rest).
router = APIRouter(prefix="/devices")
SPEECH_RATE = 16000
_bearer = HTTPBearer(auto_error=False)


def require_device_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    expected = get_settings().jarvis_device_token
    provided = credentials.credentials if credentials else ""
    if not expected or not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid device token.")


class DeviceEvent(BaseModel):
    device: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=140)
    body: str = Field(default="", max_length=1000)
    priority: str = Field(default="high", pattern="^(low|normal|high)$")


@router.post("/event", dependencies=[Depends(require_device_token)])
def device_event(event: DeviceEvent) -> dict:
    """An alert from a device (the Desk Sentry saw someone): into the inbox, to his phone."""
    try:
        return file_event(event.device, event.title, event.body, event.priority)
    except Exception as exc:  # noqa: BLE001 - tell the device, it retries later
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/avatar", dependencies=[Depends(require_device_token)])
def device_avatar(since: int = Query(default=0, ge=0)) -> dict:
    """The avatar's poll: the inbox's pending count, and Jarvis's latest
    reply if it is newer than `since`, with a one-time link to its audio."""
    return avatar_state(since)


# No token on this one: the ESP32's audio player streams a plain URL, so
# the link itself is the secret - random, single use, two minutes.
@router.get("/speech/{nonce}")
def device_speech(nonce: str) -> Response:
    text = take_speech(nonce)
    if not text:
        raise HTTPException(status_code=404, detail="No such speech, or it was already played.")
    settings = get_settings()
    if not settings.fish_audio_api_key or not settings.fish_audio_voice_id:
        raise HTTPException(status_code=503, detail="Voice is not configured.")
    try:
        audio = text_to_speech(
            text, settings.fish_audio_voice_id, settings.fish_audio_api_key, settings.fish_audio_model, pcm_rate=SPEECH_RATE
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # Raw 16-bit little-endian mono PCM: the avatar streams it straight
    # into its I2S amplifier, no decoder.
    return Response(content=audio, media_type="audio/L16", headers={"X-Sample-Rate": str(SPEECH_RATE)})
