from fastapi import APIRouter, Depends

from app.core.auth import require_routine_access
from app.services.market_updates import run_market_updates

# Market and trading-signal updates for the inbox, every 15 minutes
# (pg_cron, supabase/migrations/0012).
router = APIRouter()


@router.post("/updates/run", dependencies=[Depends(require_routine_access)])
def updates_run() -> dict:
    return run_market_updates()
