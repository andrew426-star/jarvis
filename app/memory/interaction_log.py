from typing import Any

from app.core.supabase_client import get_supabase_client

TABLE = "jarvis_interaction_log"


def fetch_recent_turns(session_id: str, limit: int = 5) -> list[dict[str, str]]:
    """Last few turns for this session, as chat messages to seed before the new one."""
    supabase = get_supabase_client()
    res = (
        supabase.table(TABLE)
        .select("user_message, assistant_response")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = list(reversed(res.data))
    turns: list[dict[str, str]] = []
    for row in rows:
        turns.append({"role": "user", "content": row["user_message"]})
        if row.get("assistant_response"):
            turns.append({"role": "assistant", "content": row["assistant_response"]})
    return turns


def write_interaction(
    *,
    interaction_id: str,
    session_id: str,
    user_message: str,
    assistant_response: str | None,
    tools_used: list[str],
    tool_call_trace: list[dict[str, Any]],
    model: str,
    latency_ms: int,
) -> None:
    supabase = get_supabase_client()
    supabase.table(TABLE).insert(
        {
            "id": interaction_id,
            "session_id": session_id,
            "user_message": user_message,
            "assistant_response": assistant_response,
            "tools_used": tools_used,
            "tool_call_trace": tool_call_trace,
            "model": model,
            "latency_ms": latency_ms,
        }
    ).execute()
