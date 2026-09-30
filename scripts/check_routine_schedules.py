"""Checks the pg_cron schedule (supabase/migrations/0006_jarvis_routine_
scheduler.sql) against the routines' Central times in app/api/routes/
brief.py: every routine must be triggered for both its daylight-time and
standard-time slot, passing that slot's cron. Run:
python scripts/check_routine_schedules.py
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.routes.brief import ROUTINES, central_utc_offset_hours, utc_cron  # noqa: E402

schedule = (
    Path(__file__).resolve().parents[1] / "supabase/migrations/0006_jarvis_routine_scheduler.sql"
).read_text()

problems = []
for routine in ROUTINES.values():
    for offset in (5, 6):
        cron = utc_cron(routine, offset)
        # The on-time job fires at the slot itself and passes it along.
        call = f"jarvis_trigger_routine('{routine.name}', '{cron}')"
        on_time = any(f"'{cron}'," in line and call in line for line in schedule.splitlines())
        if not on_time:
            problems.append(f"{routine.name}: no job firing at {cron!r} that passes it")

assert central_utc_offset_hours(datetime(2026, 9, 29, 17, tzinfo=timezone.utc)) == 5
assert central_utc_offset_hours(datetime(2026, 12, 1, 17, tzinfo=timezone.utc)) == 6
assert central_utc_offset_hours(datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)) == 5
assert central_utc_offset_hours(datetime(2026, 11, 1, 7, 30, tzinfo=timezone.utc)) == 6

if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"ok: {len(ROUTINES)} routines, {2 * len(ROUTINES)} schedules in step")
