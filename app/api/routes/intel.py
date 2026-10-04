from fastapi import APIRouter, Depends

from app.core.auth import require_routine_access
from app.services.intel import refresh_intel

# The hourly Intel refresh (pg_cron, supabase/migrations/0010): every
# category searched across the vetted outlets and stored in intel_articles,
# which Jarvis's Intel panel and K.I.V.'s Intel Hub both read.
router = APIRouter()


# Sync on purpose, like /routines: the scheduler waits for the answer.
@router.post("/intel/refresh", dependencies=[Depends(require_routine_access)])
def intel_refresh() -> dict:
    return refresh_intel()
