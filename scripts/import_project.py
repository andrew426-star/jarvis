"""Load a workshop project from a JSON file into the workshop, so it shows in
Ultron's project panel like one he made: normalized, checked, priced and
saved (app/tools/workshop_project.py). Needs the Supabase settings, so run
it where those are (the Render shell, or locally with them in .env).

    python scripts/import_project.py hardware/room-hub/project.json

An existing project with the same name is updated in place.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.tools.workshop_project import find_project, save_project  # noqa: E402


def main(path: str) -> None:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    raw.pop("id", None)
    existing = find_project(raw.get("name") or "")
    if existing:
        raw["id"] = existing["id"]
    saved = save_project(raw)
    report = saved["report"]
    print(f"Saved '{saved['project']['name']}' ({saved['project']['id']}).")
    for check in report["checks"]:
        print(f"  {check['level']}: {check['text']}")
    print(f"  Bill: ${report['bom']['estimated_total']:.2f} with tax, plus {len(report['bom']['not_stocked'])} extras.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
