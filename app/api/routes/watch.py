from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import require_access_token
from app.core.gemini import AllModelsExhausted, GeminiNotConfigured
from app.services.watch import observe

router = APIRouter()


class ObserveRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    image: str = Field(min_length=1, max_length=4_000_000)
    image_type: str = "image/jpeg"
    level: Literal["quiet", "normal", "coach"] = "normal"
    notes: str = Field(default="", max_length=4000)
    recent_remarks: list[str] = Field(default_factory=list, max_length=10)
    still_seconds: int = Field(default=0, ge=0, le=86_400)
    # What he has open in the showcase window, often the questions he is
    # answering on the board.
    on_screen: str = Field(default="", max_length=6000)
    # Serious mode is Ultron.
    persona: Literal["jarvis", "ultron"] = "jarvis"


# Watch mode's look at the whiteboard (app/services/watch.py). Sync for
# the same reason as /invoke: the Gemini client is synchronous.
@router.post("/watch/observe", dependencies=[Depends(require_access_token)])
def watch_observe(request: ObserveRequest) -> dict:
    try:
        return observe(
            request.session_id,
            request.image,
            request.image_type,
            request.level,
            request.notes,
            request.recent_remarks,
            request.still_seconds,
            request.on_screen,
            request.persona,
        )
    except GeminiNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AllModelsExhausted as exc:
        raise HTTPException(status_code=429, detail="Every vision model is at its free-tier limit for now.") from exc
