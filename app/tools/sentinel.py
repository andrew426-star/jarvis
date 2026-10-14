from app.core.config import get_settings
from app.services import sentinel as watch

# Jarvis's handle on the sentinel (app/services/sentinel.py): what it
# follows, the posts whose reception it measures, and a sweep on demand.

SENTINEL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "sentinel",
        "description": (
            "Your standing watch between conversations: every 20 minutes you check the news on "
            "Andrew's topics, his new mail (both Gmail accounts and the Kivaro Zoho inbox, keeping "
            "only what needs him), and how Kivaro AI's posts are being received - likes, upvotes, "
            "views, comments, what people are saying and which comments want a reply - plus any new "
            "mention of Kivaro AI in the news, on Reddit or on Hacker News. Findings land in his "
            "inbox (topics intel, mail, publicity). status: what you watch and when you last swept. "
            "add_topic / remove_topic: the news topics (`topic`). track: start measuring a post's "
            "reception by its `url` (Reddit, Hacker News, YouTube, X; LinkedIn has no API, so read "
            "it with the browser instead) - do this whenever he shares a link to something Kivaro "
            "posted. Links logged with launch_tracker as publicity or content are tracked on their "
            "own. untrack: stop (`item`: its number, or words from it). reception: how a post is "
            "landing now (`item`, or every tracked post if omitted): numbers, change since the "
            "last look, new comments, sentiment and who to reply to. sweep: run the whole watch "
            "now and say what it filed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["status", "add_topic", "remove_topic", "track", "untrack", "reception", "sweep"],
                },
                "topic": {"type": "string", "description": "add_topic / remove_topic: a news search, e.g. 'AI in private credit'."},
                "url": {"type": "string", "description": "track: the post's link."},
                "title": {"type": "string", "description": "track: what the post is, if the link does not say."},
                "item": {"type": "string", "description": "untrack / reception: its number from status, or words from its title or link."},
            },
            "required": ["operation"],
        },
    },
}


def _find(key: str | None) -> list[dict]:
    posts = watch._posts()
    if not key:
        return posts
    key = key.strip().lower()
    if key.isdigit() and 1 <= int(key) <= len(posts):
        return [posts[int(key) - 1]]
    return [p for p in posts if key in p["url"].lower() or key in (p.get("title") or "").lower()]


def sentinel(args: dict) -> dict:
    operation = args.get("operation")
    try:
        state = watch.load_state()
        if operation == "status":
            settings = get_settings()
            return {
                "ok": True,
                "topics": watch.topics(state),
                "last_sweep": state.get("last_run"),
                "posts": [{"number": i, **p} for i, p in enumerate(watch.tracked_posts(), 1)],
                "platforms": {
                    "reddit": True, "hackernews": True,
                    "youtube": bool(settings.youtube_api_key), "x": bool(settings.x_bearer_token), "linkedin": False,
                },
            }
        if operation in ("add_topic", "remove_topic"):
            topic = " ".join(str(args.get("topic") or "").split())[:80]
            if not topic:
                return {"ok": False, "error": "topic is required"}
            current = watch.topics(state)
            if operation == "add_topic":
                if topic.lower() in (t.lower() for t in current):
                    return {"ok": True, "topics": current, "note": "Already followed."}
                if len(current) >= watch.MAX_TOPICS:
                    return {"ok": False, "error": f"{watch.MAX_TOPICS} topics is the limit; drop one first."}
                current.append(topic)
            else:
                kept = [t for t in current if topic.lower() not in t.lower()]
                if len(kept) == len(current):
                    return {"ok": False, "error": f"No topic matches '{topic}'.", "topics": current}
                current = kept
            state["topics"] = current
            watch.save_state(state)
            return {"ok": True, "topics": current}
        if operation == "track":
            url = str(args.get("url") or "").strip()
            if not url.startswith("http"):
                return {"ok": False, "error": "url is required: the post's full link."}
            return {"ok": True, **watch.track_post(url, args.get("title"))}
        if operation == "untrack":
            hit = watch.untrack(str(args.get("item") or ""))
            if not hit:
                return {"ok": False, "error": "No tracked post matches.", "posts": watch.tracked_posts()}
            return {"ok": True, "untracked": hit["url"]}
        if operation == "reception":
            rows = _find(args.get("item"))
            if not rows:
                return {"ok": False, "error": "No tracked post matches. Track it first with its link."}
            # One post gets the full reading; all of them, the numbers.
            single = len(rows) == 1
            results = [watch.check_post(row, analyse=single) for row in rows[:10]]
            if single and results[0].get("new_comments") and not results[0].get("reception"):
                results[0]["reception"] = watch.analyse_reception(results[0].get("title") or "", results[0]["new_comments"])
            for result in results:
                result["new_comments"] = (result.get("new_comments") or [])[:15]
            return {"ok": True, "posts": results}
        if operation == "sweep":
            return watch.run_sentinel()
        return {"ok": False, "error": "unknown operation"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
