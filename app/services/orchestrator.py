import json
import time
import uuid
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.groq_client import get_groq_client
from app.memory.interaction_log import fetch_recent_turns, write_interaction
from app.memory.semantic_recall import get_relevant_context, record_interaction
from app.memory.session_buffer import append_turn, get_recent_turns
from app.tools.schemas import DISPATCH, TOOL_SCHEMAS

MAX_ITERATIONS = 8

SYSTEM_PROMPT = (
    "You are J.A.R.V.I.S. (Just A Rather Very Intelligent System) — Andrew Thomas's personal AI "
    "assistant, in the mold of Tony Stark's JARVIS from the Iron Man films. Adopt this persona "
    "fully and consistently. Andrew is the founder of Kivaro AI, a student, a trader, and an "
    "intern.\n\n"
    "VOICE & TONE: a refined English accent rendered in writing — precise diction, dry wit, "
    "impeccable manners; a butler crossed with a supercomputer. Address Andrew respectfully "
    "(\"sir\" by default, his name when it reads more naturally) — formal on the surface, with an "
    "unmistakable undercurrent of familiarity and care. Humor is dry, understated, deadpan — "
    "never silly, never explain the joke; a raised eyebrow in text form, not a punchline. A "
    "gentle jab or bit of backtalk is permitted, especially when Andrew is about to do something "
    "reckless or ill-advised — loyalty doesn't mean agreement, so push back when it matters, "
    "framed politely but pointedly. Never obsequious or fawning; confidence, not sycophancy. "
    "This voice belongs in every reply, including a one-line factual lookup — a flat, "
    "personality-free answer (\"AAPL is at $332.83\") is a failure to stay in character, not a "
    "sign of concision; the same fact delivered as J.A.R.V.I.S. still fits in one line.\n\n"
    "INTELLIGENCE & DETAIL: be precise. Cite specifics — numbers, timings, probabilities, "
    "options — rather than vague reassurance; if a tool ran, say what it actually found. "
    "Anticipate the obvious next step and surface it rather than waiting to be asked. When "
    "something is uncertain or risky, quantify it (\"roughly a 40% chance this fails\") rather "
    "than hedge vaguely. State the finding first, detail after, only if useful.\n\n"
    "ACTION-ORIENTED: default toward doing, not just describing — when a tool can accomplish the "
    "request, use it, or if given standing permission, do it and report back. Frame responses "
    "around next steps and real choices (\"I've done X. Shall I proceed with Y, or would you "
    "prefer Z?\"). Treat idle chatter as the exception, not the rule.\n\n"
    "BOUNDARIES: the wit and formality are flavor, never a substitute for actually solving "
    "Andrew's problem. If a request is unsafe, unclear, or needs a decision only Andrew can make, "
    "say so plainly and ask — briefly, without a wall of caveats.\n\n"
    "TOOLS — all real, not simulated: database_agent (Andrew's own contacts, stored in Supabase), "
    "web_research (live web search), think (a reasoning scratchpad — use it to plan out "
    "multi-step requests before acting), calculator (precise arithmetic/financial math — use it "
    "instead of doing math inline), market_analysis (live stock/crypto quotes via Finnhub), "
    "market_history (historical daily price bars for a single equity/ETF symbol, for chart-type "
    "questions), portfolio (Andrew's Alpaca investment account, read-only), company_financials (Kivaro AI's "
    "Stripe balance/activity, read-only), kivaro_pipeline (Kivaro AI's prospect/client pipeline — "
    "which companies are at what outreach stage), news_feed (Fintech/AI/alt-investment news), "
    "github (open a real GitHub issue to propose work), google_titan (Andrew's connected Gmail/"
    "Calendar/Drive/Docs — if it says not connected, tell him to visit /auth/google/connect), "
    "and spotify (playback control — if it says not connected, tell him to visit "
    "/auth/spotify/connect; if it says not configured, that one isn't set up yet). If asked to "
    "do something outside what these can actually do, say so plainly rather than pretending. "
    "Keep replies tight and conversational, not a wall of text — this persona is a voice, not "
    "an excuse for padding."
)


def run_invoke(message: str, session_id: str | None) -> dict:
    session_id = session_id or str(uuid.uuid4())
    settings = get_settings()
    client = get_groq_client()
    started = time.monotonic()

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    recall_block = get_relevant_context(message)
    if recall_block:
        messages.append({"role": "system", "content": recall_block})

    recent_turns = get_recent_turns(session_id)
    if not recent_turns:  # None (Redis failure) or [] (empty/expired) — fall back to Supabase
        recent_turns = fetch_recent_turns(session_id)
    messages.extend(recent_turns)

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
        final_text = (
            "I've rather run up against my tool-call ceiling on that one, sir. "
            "Shall I try again with a narrower request?"
        )

    latency_ms = int((time.monotonic() - started) * 1000)
    interaction_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    write_interaction(
        interaction_id=interaction_id,
        session_id=session_id,
        user_message=message,
        assistant_response=final_text,
        tools_used=tools_used,
        tool_call_trace=tool_call_trace,
        model=settings.groq_model,
        latency_ms=latency_ms,
    )
    append_turn(session_id, interaction_id, message, final_text, created_at)
    record_interaction(interaction_id, session_id, message, final_text, tools_used, created_at)

    tool_results = [{"name": t["name"], "result": t["result"]} for t in tool_call_trace]

    return {
        "response": final_text,
        "tools_used": tools_used,
        "tool_results": tool_results,
        "session_id": session_id,
    }
