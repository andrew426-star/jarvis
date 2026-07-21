from fastapi import APIRouter

from app.schemas.invoke import InvokeRequest, InvokeResponse
from app.services.orchestrator import run_invoke

router = APIRouter()


# Sync (not async) on purpose — supabase-py and the Groq client are both
# synchronous; a plain `def` route lets FastAPI run this in its threadpool
# automatically rather than blocking the event loop.
@router.post("/invoke", response_model=InvokeResponse)
def invoke(request: InvokeRequest) -> InvokeResponse:
    result = run_invoke(request.message, request.session_id)
    return InvokeResponse(**result)
