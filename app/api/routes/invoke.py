from fastapi import APIRouter, Depends, Query

from app.core.auth import require_access_token
from app.core.config import get_settings
from app.memory.session_buffer import count_turns
from app.schemas.invoke import InvokeRequest, InvokeResponse, SessionContext
from app.services.orchestrator import run_invoke

router = APIRouter()


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
