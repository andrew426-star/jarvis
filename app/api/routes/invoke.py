import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse

from app.core.auth import require_access_token, require_browser_or_full
from app.core.config import get_settings
from app.memory.session_buffer import count_turns
from app.schemas.invoke import InvokeRequest, InvokeResponse, SessionContext
from app.services.orchestrator import run_invoke, stream_invoke

router = APIRouter()
logger = logging.getLogger(__name__)


# Sync (not async) on purpose — supabase-py and the Gemini client are both
# synchronous; a plain `def` route lets FastAPI run this in its threadpool
# automatically rather than blocking the event loop.
@router.post("/invoke", response_model=InvokeResponse, dependencies=[Depends(require_access_token)])
def invoke(request: InvokeRequest) -> InvokeResponse:
    result = run_invoke(
        request.message,
        request.session_id,
        channel=request.channel,
        image=request.image,
        image_type=request.image_type,
        look=request.look,
        console_state=request.console_state,
        attachments=[a.model_dump() for a in request.attachments],
    )
    return InvokeResponse(**result)


# Lets the console show how much Jarvis remembers as soon as it loads,
# before anything is said: the session id survives a reload, and so does
# its memory.
@router.get(
    "/session/context", response_model=SessionContext, dependencies=[Depends(require_access_token)]
)
def session_context(session_id: str = Query(min_length=1, max_length=128)) -> SessionContext:
    return SessionContext(
        turns=count_turns(session_id), window=get_settings().redis_session_window_turns
    )


# The same turn as /invoke, streamed as newline-delimited JSON events
# (see stream_invoke) so the console can show and speak the reply while it
# is still being written. A plain def generator: Starlette iterates it in
# its threadpool, like the sync /invoke route.
# Also open to the browser extension: its page bubble talks to Jarvis here.
@router.post("/invoke/stream", dependencies=[Depends(require_browser_or_full)])
def invoke_stream(request: InvokeRequest) -> StreamingResponse:
    def events():
        try:
            for event in stream_invoke(
                request.message,
                request.session_id,
                channel=request.channel,
                image=request.image,
                image_type=request.image_type,
                look=request.look,
                console_state=request.console_state,
                attachments=[a.model_dump() for a in request.attachments],
            ):
                yield json.dumps(event, default=str) + "\n"
        except Exception as exc:  # noqa: BLE001 — headers are sent; report in-band instead
            logger.exception("invoke stream failed")
            yield json.dumps({"type": "error", "message": str(exc)}) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        # No proxy buffering, or the events arrive all at once at the end.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class RenderRequest(BaseModel):
    image: str = Field(min_length=1, max_length=12_000_000)
    image_type: str = "image/png"
    prompt: str | None = Field(default=None, max_length=600)


# A photoreal render of a workshop view (app/integrations/gemini_render.py).
@router.post("/render", dependencies=[Depends(require_access_token)])
def render(request: RenderRequest) -> dict:
    from app.core.gemini import AllModelsExhausted, GeminiNotConfigured
    from app.integrations.gemini_render import render_image

    try:
        return {"ok": True, **render_image(request.image, request.image_type, request.prompt)}
    except GeminiNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AllModelsExhausted as exc:
        raise HTTPException(status_code=429, detail="Every image model is at its free-tier limit for now.") from exc
    except Exception as exc:  # noqa: BLE001 — say why the render failed rather than a bare 500
        raise HTTPException(status_code=502, detail=f"Render failed: {exc}") from exc
