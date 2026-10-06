import json

from app.services.inbox import add_item
from app.tools.schemas import DISPATCH, TOOL_SCHEMAS

# The tools Jarvis has on his rounds (app/services/autonomy.py), when he
# runs without Andrew there. He may read anything below; every other call,
# anything that would send, create, change or log something, is refused
# and has to go through `propose`, which files it in the inbox for Andrew
# to approve. That gate is here in code, not in the prompt: what the model
# is told to do and what it can do are kept the same.
#
# None means every operation of that tool only reads. A tool not listed
# is not offered on rounds at all.
READ_ONLY: dict[str, set[str] | None] = {
    "database_agent": {"list_contacts", "get_contact"},
    "google_titan": {
        "gmail_list_messages",
        "gmail_get_message",
        "calendar_list_events",
        "drive_search_files",
        "docs_get_document",
    },
    "launch_tracker": {"status"},
    "kiv_tasks": {"list"},
    "habits": {"status"},
    "italian": {"progress"},
    "checklist": {"list", "show"},
    "zoho_mail": None,
    "files": None,
    "browser": {"current_page", "tabs", "read_tab", "elements"},
    "notes": None,
    "history": None,
    "web_research": None,
    "news_feed": None,
    "market_analysis": None,
    "market_history": None,
    "portfolio": None,
    "company_financials": None,
    "kivaro_pipeline": {"status", "find"},
    "calculator": None,
    "trade_signals": None,
    "parts_catalog": None,
}

# What a proposal may ask to run once approved: any of his ordinary tools
# but those with no point while he is away. Browser actions act on whatever
# page is open when he approves, not the one Jarvis saw, so they are out too.
NOT_PROPOSABLE = {"spotify", "speech_coach", "think", "inbox", "browser"}

MAX_PROPOSALS = 3
MAX_NOTICES = 3

PROPOSE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose",
        "description": (
            "Ask Andrew's approval for one action: a single call to one of your tools (send an "
            "email, update a task, log something, create a checklist, open a GitHub issue...). It "
            "goes to his inbox and runs only if he approves it. Write exactly the call you would "
            "make, so approving it is all he has to do. Propose only what clearly moves his work "
            "forward and he would plausibly want; at most three per round."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "What it does, in a few words: 'Email Dr. Lee the lab 4 question'."},
                "why": {"type": "string", "description": "One or two sentences: why now, from what you saw."},
                "tool": {"type": "string", "description": "The tool to call, e.g. kiv_tasks."},
                "args_json": {
                    "type": "string",
                    "description": 'The call\'s arguments as a JSON object, e.g. {"operation": "update", "task": "...", "status": "done"}.',
                },
                "priority": {"type": "string", "enum": ["low", "normal", "high"]},
            },
            "required": ["title", "why", "tool", "args_json"],
        },
    },
}

NOTIFY_SCHEMA = {
    "type": "function",
    "function": {
        "name": "notify",
        "description": (
            "Tell Andrew something worth knowing now, with no action needed from you: a deadline "
            "closing in, a reply he has been waiting for, a launch metric off pace, a clash in his "
            "calendar. It goes to his inbox and his phone. high: he should see it within the hour; "
            "normal: today; low: inbox only, no buzz. At most three per round, and only what he "
            "does not already know."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The point, in under ten words."},
                "body": {"type": "string", "description": "Two sentences at most: what, and why it matters."},
                "priority": {"type": "string", "enum": ["low", "normal", "high"]},
            },
            "required": ["title", "body"],
        },
    },
}


def _allowed(name: str, args: dict) -> bool:
    ops = READ_ONLY.get(name, ...)
    if ops is ...:
        return False
    return ops is None or args.get("operation") in ops


def round_tools(session_id: str) -> tuple[list[dict], dict, list[dict]]:
    """Schemas and handlers for one round, and the list it files into (for
    the one push at the end)."""
    filed: list[dict] = []

    def gated(name: str):
        handler = DISPATCH[name]

        def run(args: dict) -> dict:
            if not _allowed(name, args):
                return {
                    "ok": False,
                    "held": True,
                    "error": "On rounds you can only read. To do this, call propose with this tool "
                    "and these args, and say why; Andrew decides.",
                }
            return handler(args)

        return run

    def propose(args: dict) -> dict:
        if sum(1 for f in filed if f["kind"] == "proposal") >= MAX_PROPOSALS:
            return {"ok": False, "error": "Three proposals is the limit for a round."}
        tool = str(args.get("tool") or "").strip()
        if tool not in DISPATCH or tool in NOT_PROPOSABLE:
            return {"ok": False, "error": f"'{tool}' cannot be proposed."}
        try:
            call_args = json.loads(args.get("args_json") or "{}")
        except json.JSONDecodeError as exc:
            return {"ok": False, "error": f"args_json is not valid JSON: {exc}"}
        if not isinstance(call_args, dict):
            return {"ok": False, "error": "args_json must be a JSON object."}
        item = add_item(
            "proposal",
            str(args.get("title") or ""),
            str(args.get("why") or ""),
            str(args.get("priority") or "normal"),
            tool=tool,
            args=call_args,
            session_id=session_id,
        )
        if item is None:
            return {"ok": True, "skipped": "That is already in his inbox."}
        filed.append(item)
        return {"ok": True, "filed": item["id"]}

    def notify(args: dict) -> dict:
        if sum(1 for f in filed if f["kind"] == "notice") >= MAX_NOTICES:
            return {"ok": False, "error": "Three notices is the limit for a round."}
        item = add_item(
            "notice",
            str(args.get("title") or ""),
            str(args.get("body") or ""),
            str(args.get("priority") or "normal"),
            session_id=session_id,
        )
        if item is None:
            return {"ok": True, "skipped": "He has already been told that today."}
        filed.append(item)
        return {"ok": True, "filed": item["id"]}

    schemas = [s for s in TOOL_SCHEMAS if s["function"]["name"] in READ_ONLY] + [PROPOSE_SCHEMA, NOTIFY_SCHEMA]
    handlers = {name: gated(name) for name in READ_ONLY if name in DISPATCH}
    handlers["propose"] = propose
    handlers["notify"] = notify
    return schemas, handlers, filed
