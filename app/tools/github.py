import httpx

from app.core.config import get_settings

GITHUB_API_BASE = "https://api.github.com"


def github(args: dict) -> dict:
    title = args.get("title")
    body = args.get("body") or ""
    if not title:
        return {"ok": False, "error": "title is required"}

    settings = get_settings()
    try:
        res = httpx.post(
            f"{GITHUB_API_BASE}/repos/{settings.github_repo_owner}/{settings.github_repo_name}/issues",
            headers={
                "Authorization": f"Bearer {settings.github_token}",
                "Accept": "application/vnd.github+json",
                "Content-Type": "application/json",
            },
            json={"title": title, "body": body},
            timeout=15.0,
        )
        if not res.is_success:
            raise RuntimeError(f"GitHub issue creation failed: {res.text}")
        return {"ok": True, "issue_url": res.json()["html_url"]}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": str(exc)}
