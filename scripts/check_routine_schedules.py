"""Checks .github/workflows/jarvis-routines.yml against the routines'
Central times in app/api/routes/brief.py: every routine must be scheduled
at both its daylight-time and standard-time UTC crons, and mapped back to
itself. Run: python scripts/check_routine_schedules.py
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.routes.brief import ROUTINES, central_utc_offset_hours, utc_cron  # noqa: E402

workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/jarvis-routines.yml").read_text()

problems = []
for routine in ROUTINES.values():
    for offset in (5, 6):
        cron = utc_cron(routine, offset)
        if f'- cron: "{cron}"' not in workflow:
            problems.append(f"{routine.name}: missing schedule {cron!r}")
        mapped = any(
            f'"{cron}"' in line and f"routine={routine.name}" in line for line in workflow.splitlines()
        )
        if not mapped:
            problems.append(f"{routine.name}: {cron!r} not mapped to the routine")

assert central_utc_offset_hours(datetime(2026, 9, 29, 17, tzinfo=timezone.utc)) == 5
assert central_utc_offset_hours(datetime(2026, 12, 1, 17, tzinfo=timezone.utc)) == 6
assert central_utc_offset_hours(datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)) == 5
assert central_utc_offset_hours(datetime(2026, 11, 1, 7, 30, tzinfo=timezone.utc)) == 6

if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"ok: {len(ROUTINES)} routines, {2 * len(ROUTINES)} schedules in step")
