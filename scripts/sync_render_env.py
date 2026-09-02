"""Push a local .env to a Render service, instead of retyping it.

Render's dashboard is the only place these values live today, which means
every credential change is a manual edit in a web form, and the local
.env and the deployed one drift apart silently. They have drifted at
least three times in this project: ELEVENLABS_API_KEY held a key ID for
weeks, SPOTIFY_REDIRECT_URI and ZOHO_REDIRECT_URI still point at a
decommissioned Railway host, and JARVIS_FRONTEND_ORIGIN names a frontend
that no longer exists.

This makes the file the source of truth and the service a copy of it.

    export RENDER_API_KEY=rnd_...
    python scripts/sync_render_env.py --service jarvis            # dry run
    python scripts/sync_render_env.py --service jarvis --apply

Dry run is the default and prints a masked diff. Nothing is written
without --apply, because Render's env-var endpoint REPLACES the whole set
- a key you delete locally is deleted in production, which is the point,
but it is not something to discover after the fact.

Values are never printed. The diff shows key names and whether each is
added, changed, removed or unchanged.
"""

import argparse
import os
import sys

import httpx

API = "https://api.render.com/v1"

# Never synced, whatever the local file says.
#
# *_LOGIN_RETURN_ORIGIN must stay unset in production: unset means the
# sign-in redirect is relative, which is always the host the request
# actually arrived on. Setting it is how sign-in ended up pointing at a
# dead Railway deployment once already.
DEFAULT_SKIP = {
    "JARVIS_LOGIN_RETURN_ORIGIN",
    "ULTRON_LOGIN_RETURN_ORIGIN",
}


def read_env_file(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            # .strip() rather than .rstrip("\n"): these files are edited on
            # Windows and a trailing \r inside a credential produces
            # authentication failures that look like nothing at all.
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if value:
                values[key] = value
    return values


def mask(value: str) -> str:
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-2:]} ({len(value)} chars)"


def find_service(client: httpx.Client, name: str) -> dict:
    res = client.get(f"{API}/services", params={"name": name, "limit": 20})
    res.raise_for_status()
    matches = [row["service"] for row in res.json()]
    if not matches:
        sys.exit(f"No Render service named {name!r}. Check the name in render.yaml.")
    if len(matches) > 1:
        names = ", ".join(f"{s['name']} ({s['id']})" for s in matches)
        sys.exit(f"{len(matches)} services match {name!r}: {names}")
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", required=True, help="Render service name")
    parser.add_argument("--env-file", default=".env")
    parser.add_argument(
        "--overlay",
        default=".env.render",
        help="Production-only values layered over --env-file, if the file exists",
    )
    parser.add_argument("--skip", action="append", default=[], help="Key to leave alone (repeatable)")
    parser.add_argument("--apply", action="store_true", help="Actually write. Without this, dry run.")
    parser.add_argument(
        "--no-deploy",
        action="store_true",
        help="Write the values but do not restart the service (it keeps its old environment)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("RENDER_API_KEY")
    if not api_key:
        sys.exit("RENDER_API_KEY is not set. Create one at dashboard.render.com/u/settings#api-keys")

    skip = DEFAULT_SKIP | set(args.skip)
    merged = read_env_file(args.env_file)

    # The overlay exists because a local .env is not a production .env.
    # Ultron's holds http://localhost:8000/auth/login/callback so sign-in
    # works against `next dev`; pushing that value would break the
    # deployed console in precisely the way this project has already been
    # broken once. Anything host-specific belongs here.
    if os.path.exists(args.overlay):
        overrides = read_env_file(args.overlay)
        merged.update(overrides)
        print(f"overlay : {args.overlay} ({len(overrides)} values)")

    local = {k: v for k, v in merged.items() if k not in skip}
    if not local:
        sys.exit(f"{args.env_file} has no values to sync.")

    client = httpx.Client(headers={"Authorization": f"Bearer {api_key}"}, timeout=30.0)
    service = find_service(client, args.service)

    res = client.get(f"{API}/services/{service['id']}/env-vars", params={"limit": 100})
    res.raise_for_status()
    remote = {row["envVar"]["key"]: row["envVar"].get("value", "") for row in res.json()}

    added = sorted(set(local) - set(remote))
    removed = sorted(k for k in set(remote) - set(local) if k not in skip)
    changed = sorted(k for k in set(local) & set(remote) if local[k] != remote[k])
    same = sorted(k for k in set(local) & set(remote) if local[k] == remote[k])

    print(f"service : {service['name']} ({service['id']})")
    print(f"source  : {args.env_file}")
    print()
    for key in added:
        print(f"  + {key:32} {mask(local[key])}")
    for key in changed:
        print(f"  ~ {key:32} {mask(remote[key])} -> {mask(local[key])}")
    for key in removed:
        print(f"  - {key:32} {mask(remote[key])}  (DELETED from the service)")
    print(f"\n  {len(same)} unchanged, {len(added)} added, {len(changed)} changed, {len(removed)} removed")

    if not (added or changed or removed):
        print("\nNothing to do.")
        return 0

    if not args.apply:
        print("\nDry run. Re-run with --apply to write this to Render.")
        return 0

    # PUT replaces the entire set, which is what makes removals work.
    payload = [{"key": k, "value": v} for k, v in sorted(local.items())]
    res = client.put(f"{API}/services/{service['id']}/env-vars", json=payload)
    res.raise_for_status()
    print("\nWritten.")

    # A dashboard edit restarts the service; this API write does not. The
    # values sit on the service while the running container keeps the
    # environment it booted with, so the sync looks applied and changes
    # nothing until something else deploys. Observed exactly once, which
    # was enough: /speak went on reporting "voice is not configured" with
    # the credentials plainly present on the service.
    if args.no_deploy:
        print("Not deploying. The running container keeps its old environment until you do.")
        return 0

    res = client.post(
        f"{API}/services/{service['id']}/deploys", json={"clearCache": "do_not_clear"}
    )
    res.raise_for_status()
    print(f"Deploy triggered: {res.json().get('id', '?')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
