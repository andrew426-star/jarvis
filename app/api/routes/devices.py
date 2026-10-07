import hmac

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.services.devices import file_event

# The workshop's ESP32 builds talking to Jarvis (app/services/devices.py).
# They hold JARVIS_DEVICE_TOKEN, which opens these routes and nothing else:
# a device can file an alert, never act as Andrew. Unset, every device route refuses (fails closed, like the rest).
router = APIRouter(prefix="/devices")
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

