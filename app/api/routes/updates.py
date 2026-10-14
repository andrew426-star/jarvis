from fastapi import APIRouter, Depends

from app.core.auth import require_routine_access
from app.services.market_updates import run_market_updates
from app.services.sentinel import run_sentinel
from app.tools.reminders import run_due_reminders

# Market and trading-signal updates for the inbox, every 15 minutes
# (pg_cron, supabase/migrations/0012), and reminders that have come due,
# every minute (supabase/migrations/0015).
router = APIRouter()


@router.post("/updates/run", dependencies=[Depends(require_routine_access)])
def updates_run() -> dict:
    return run_market_updates()


@router.post("/reminders/run", dependencies=[Depends(require_routine_access)])
def reminders_run() -> dict:
    return run_due_reminders()


# The sentinel's sweep: news, mail and publicity, every 20 minutes
# (supabase/migrations/0016).
@router.post("/sentinel/run", dependencies=[Depends(require_routine_access)])
def sentinel_run() -> dict:
    return run_sentinel()
