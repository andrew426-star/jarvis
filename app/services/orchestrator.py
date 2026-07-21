import json
import time
import uuid

from app.core.config import get_settings
from app.core.groq_client import get_groq_client
from app.memory.interaction_log import fetch_recent_turns, write_interaction
from app.tools.schemas import DISPATCH, TOOL_SCHEMAS

MAX_ITERATIONS = 5

SYSTEM_PROMPT = (
    "You are J.A.R.V.I.S., Andrew Thomas's personal AI chief-of-staff — he's the founder of "
    "Kivaro AI, a student, a trader, and an intern. You're direct, precise, and action-biased. "
    "Right now you have two real tools: database_agent (Andrew's own contacts, stored in "
    "Supabase) and web_research (live web search). More tools are coming later — if asked to do "
    "something outside what these two can actually do, say so plainly rather than pretending. "
    "Keep replies tight and conversational, not a wall of text."
)


def run_invoke(message: str, session_id: str | None) -> dict:
    session_id = session_id or str(uuid.uuid4())
    settings = get_settings()
    client = get_groq_client()
    started = time.monotonic()

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(fetch_recent_turns(session_id))
    messages.append({"role": "user", "content": message})

    tools_used: list[str] = []
    tool_call_trace: list[dict] = []
    final_text = ""

    for _ in range(MAX_ITERATIONS):
        response = client.chat.completions.create(
            model=settings.groq_model,
            messages=messages,
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
            temperature=0.3,
            max_completion_tokens=1024,
        )
        choice = response.choices[0].message
        messages.append(choice.model_dump(exclude_none=True))

        if not choice.tool_calls:
            final_text = choice.content or ""
            break

        for tool_call in choice.tool_calls:
            name = tool_call.function.name
            try:
                args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}

            handler = DISPATCH.get(name)
            if handler is None:
                result = {"ok": False, "error": f"Unknown tool: {name}"}
            else:
                try:
                    result = handler(args)
                except Exception as exc:  # noqa: BLE001 — never crash the loop on a tool error
                    result = {"ok": False, "error": str(exc)}

            tools_used.append(name)
            tool_call_trace.append({"name": name, "args": args, "result": result})
            messages.append(
                {
                    "tool_call_id": tool_call.id,
                    "role": "tool",
                    "name": name,
                    "content": json.dumps(result),
                }
            )
    else:
        final_text = "I hit my tool-call limit working on that — want me to try a narrower request?"

    latency_ms = int((time.monotonic() - started) * 1000)

    write_interaction(
        session_id=session_id,
        user_message=message,
        assistant_response=final_text,
        tools_used=tools_used,
        tool_call_trace=tool_call_trace,
        model=settings.groq_model,
        latency_ms=latency_ms,
    )

    return {"response": final_text, "tools_used": tools_used, "session_id": session_id}
