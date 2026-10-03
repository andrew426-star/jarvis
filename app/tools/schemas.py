from app.tools.calculator import calculator
from app.tools.company_financials import company_financials
from app.tools.database_agent import database_agent
from app.tools.browser import BROWSER_SCHEMA, browser
from app.tools.files import FILES_SCHEMA, files
from app.tools.github import github
from app.tools.google_titan import google_titan
from app.tools.kivaro_pipeline import kivaro_pipeline
from app.tools.habits import habits
from app.tools.italian import italian
from app.tools.kiv_tasks import kiv_tasks
from app.tools.speech_coach import speech_coach
from app.tools.launch_tracker import launch_tracker
from app.tools.market_analysis import market_analysis
from app.tools.market_history import market_history
from app.tools.news_feed import news_feed
from app.tools.portfolio import portfolio
from app.tools.spotify import spotify
from app.tools.think import think
from app.tools.web_research import web_research
from app.tools.zoho_mail import zoho_mail

# OpenAI-shaped tool declarations (from the Groq era). orchestrator.py wraps
# each one as a Gemini FunctionDeclaration; the JSON Schema is unchanged.
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "database_agent",
            "description": (
                "Read or write Andrew's structured personal data in Jarvis's own private "
                "Supabase tables (currently: contacts). Use to look up a contact, list "
                "contacts, add a new contact, or update an existing one. This is Jarvis's "
                "own data store, separate from any business/company data."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["list_contacts", "get_contact", "create_contact", "update_contact"],
                    },
                    "contact_id": {
                        "type": "string",
                        "description": "UUID, required for get_contact/update_contact when known.",
                    },
                    "query": {
                        "type": "string",
                        "description": "Free-text name search, for list_contacts or finding a contact by name.",
                    },
                    "contact": {
                        "type": "object",
                        "description": "Fields to set on create_contact or update_contact.",
                        "properties": {
                            "name": {"type": "string"},
                            "relationship": {
                                "type": "string",
                                "enum": ["family", "friend", "colleague", "client", "investor", "other"],
                            },
                            "email": {"type": "string"},
                            "phone": {"type": "string"},
                            "notes": {"type": "string"},
                            "tags": {"type": "array", "items": {"type": "string"}},
                        },
                    },
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "market_analysis",
            "description": (
                "Get live market quotes (price, change, % change) for stock/ETF/crypto ticker "
                "symbols via Finnhub. Use for questions about current prices, market movement, "
                "or a watchlist check. If no symbols are given, returns a default watchlist "
                "(SPY, QQQ, AAPL, NVDA, BTC, ETH)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Ticker symbols in Finnhub format (e.g. 'AAPL', "
                        "'BINANCE:BTCUSDT' for crypto). Omit for the default watchlist.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "market_history",
            "description": (
                "Get historical daily price bars (open/high/low/close/volume) for a single "
                "stock or ETF symbol, via Alpaca — use for 'show me a chart of X' or 'how has X "
                "moved this month' type questions. Equities/ETFs only, not crypto."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "A single ticker symbol, e.g. 'AAPL'."},
                    "days": {
                        "type": "integer",
                        "description": "How many days of history to look back. Default 30.",
                    },
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "google_titan",
            "description": (
                "Andrew's connected Google accounts — Gmail, Calendar, Drive, and Docs. Use to "
                "list/search/read/send Gmail messages, list/create Calendar events, search "
                "Drive files by name or content, and create/read Google Docs. Two accounts: "
                "'kivaro' (his company account, full access) and 'school' (his Louisiana Tech "
                "account, agt537@email.latech.edu, read-only: mail and calendar). Listing mail "
                "or events covers both by default and tags each item with its account."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": [
                            "gmail_list_messages",
                            "gmail_get_message",
                            "gmail_send_message",
                            "calendar_list_events",
                            "calendar_create_event",
                            "drive_search_files",
                            "docs_create_document",
                            "docs_get_document",
                        ],
                    },
                    "account": {
                        "type": "string",
                        "enum": ["kivaro", "school", "all"],
                        "description": "Which Google account. gmail_list_messages and "
                        "calendar_list_events default to 'all'. gmail_get_message defaults to "
                        "'kivaro'; pass the `account` from the listed message to read a school "
                        "email. Everything else (sending, creating events, Drive, Docs) is "
                        "Kivaro-only.",
                    },
                    "query": {
                        "type": "string",
                        "description": "Gmail search syntax for gmail_list_messages (e.g. "
                        "'from:x newer_than:7d'), or free-text file/content search for "
                        "drive_search_files.",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Result cap for gmail_list_messages, calendar_list_events, "
                        "drive_search_files.",
                    },
                    "message_id": {
                        "type": "string",
                        "description": "Gmail message id, required for gmail_get_message.",
                    },
                    "to": {"type": "string", "description": "Recipient email address, for gmail_send_message."},
                    "subject": {
                        "type": "string",
                        "description": "Email subject, for gmail_send_message. When replying, "
                        "must match the original subject (a 'Re: ' prefix is fine).",
                    },
                    "body": {"type": "string", "description": "Plain-text email body, for gmail_send_message."},
                    "thread_id": {
                        "type": "string",
                        "description": "Gmail threadId to reply within, from a prior "
                        "gmail_list_messages/gmail_get_message result. For gmail_send_message.",
                    },
                    "in_reply_to": {
                        "type": "string",
                        "description": "The RFC 822 Message-ID header (not the Gmail id) of the "
                        "message being replied to — from gmail_get_message's message_id_header "
                        "field. For gmail_send_message.",
                    },
                    "days_ahead": {
                        "type": "integer",
                        "description": "Lookahead window in days for calendar_list_events. Default 14.",
                    },
                    "event": {
                        "type": "object",
                        "description": "Event fields for calendar_create_event.",
                        "properties": {
                            "summary": {"type": "string"},
                            "description": {"type": "string"},
                            "start": {
                                "type": "string",
                                "description": "RFC3339 datetime with UTC offset (e.g. "
                                "'2026-07-25T14:00:00-04:00') for timed events, or 'YYYY-MM-DD' "
                                "for all-day.",
                            },
                            "end": {"type": "string", "description": "Same format as start."},
                            "timezone": {
                                "type": "string",
                                "description": "IANA timezone (e.g. 'America/New_York'). Only "
                                "needed if start/end omit a UTC offset.",
                            },
                            "attendees": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Attendee email addresses.",
                            },
                        },
                    },
                    "document_id": {
                        "type": "string",
                        "description": "Google Doc id, required for docs_get_document.",
                    },
                    "title": {"type": "string", "description": "Document title, for docs_create_document."},
                    "content": {
                        "type": "string",
                        "description": "Initial plain-text body content, for docs_create_document. "
                        "Optional — omit for a blank doc.",
                    },
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_research",
            "description": (
                "Search the web for current information — news, facts, prices, anything "
                "that might have changed since training or that you don't already know. "
                "Returns source snippets to synthesize an answer from; does not answer on its own."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "think",
            "description": (
                "A reasoning scratchpad — use to plan out a multi-step request before acting, "
                "or reflect on a result, without taking any real action. Does not search, "
                "read, or write anything."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "thought": {"type": "string", "description": "The reasoning/plan, written out."},
                    "thought_type": {
                        "type": "string",
                        "enum": ["planning", "reflection", "hypothesis", "decision", "other"],
                    },
                },
                "required": ["thought"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": (
                "Evaluate an arithmetic or financial expression precisely — use instead of doing "
                "math inline, especially for anything with more than one or two steps. Supports "
                "+ - * / ** // %, and named functions: compound_interest(principal, rate, years, "
                "periods_per_year=1), simple_interest(principal, rate, years), "
                "percentage(part, whole), percentage_change(old, new), sqrt, round, abs, min, max."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "e.g. '12000 * 1.08 ** 3' or 'compound_interest(12000, 0.08, 3, 12)'.",
                    },
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "portfolio",
            "description": (
                "Get Andrew's investment account — equity, cash, buying power, and open "
                "positions with unrealized P/L, via Alpaca. Read-only, paper-trading account."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "company_financials",
            "description": (
                "Get Kivaro AI's live Stripe balance (available/pending) and recent account "
                "activity. Read-only — there is no capability to issue charges, refunds, or payouts."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kivaro_pipeline",
            "description": (
                "Get Kivaro AI's current prospect and client pipeline — which companies are at "
                "what stage in the outreach process. Covers the Autonomous Lead Engine's "
                "automated pipeline (discovered, researched, or pitched) and existing clients "
                "with their status (active, paused, completed)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "launch_tracker",
            "description": (
                "Kivaro AI's launch tracker, shared with K.I.V.'s Launch page and Slack agents. "
                "operation=status returns days to the January 2027 launch, the current phase "
                "(Discovery, Pilots, Commitments, Launch) with its goal and days left, logged "
                "conversations, pilots, commitments, publicity actions and content against each "
                "phase's target, conversations by target segment, and recent activity. "
                "operation=log records one thing that actually happened. Only log what Andrew "
                "says really happened, never a plan or an idea."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["status", "log"]},
                    "kind": {
                        "type": "string",
                        "enum": ["conversation", "pilot", "commitment", "publicity", "content"],
                        "description": "Required for log.",
                    },
                    "company": {"type": "string", "description": "Firm or outlet involved."},
                    "contact": {"type": "string", "description": "Person involved, with title if known."},
                    "segment": {
                        "type": "string",
                        "enum": [
                            "hedge_fund",
                            "research_analytics",
                            "investor_relations",
                            "quant",
                            "venture_capital",
                            "private_equity",
                        ],
                    },
                    "notes": {
                        "type": "string",
                        "description": "What was said or learned, next step, price discussed.",
                    },
                    "occurred_on": {"type": "string", "description": "YYYY-MM-DD. Omit for today."},
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kiv_tasks",
            "description": (
                "K.I.V.'s Company Dashboard task board: the launch-phase projects and the Founder "
                "Development projects (Italian, public speaking, style). operation=list shows open "
                "tasks, soonest due first, with overdue flags (filter by due_within_days, project "
                "name, or statuses). operation=update changes a task's status or due_date, found by "
                "task_id or title. operation=create adds a task to a project."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["list", "update", "create"]},
                    "due_within_days": {"type": "integer", "description": "list: only tasks due within N days (includes overdue)."},
                    "project": {"type": "string", "description": "Project name or part of it, e.g. 'Discovery' or 'Italian'."},
                    "statuses": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["todo", "in_progress", "blocked", "done"]},
                        "description": "list: defaults to open tasks (todo, in_progress, blocked).",
                    },
                    "task_id": {"type": "string"},
                    "title": {"type": "string", "description": "update: task title or part of it. create: the new task's title."},
                    "status": {"type": "string", "enum": ["todo", "in_progress", "blocked", "done"]},
                    "due_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "description": {"type": "string"},
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "habits",
            "description": (
                "Andrew's daily founder-development habits: italian (20 min), articulation drills "
                "(10 min), speaking (recorded 2-minute talk), grooming. operation=log records one "
                "done today (or on done_on), adding minutes if logged twice; operation=status gives "
                "what's done and still to do today, streaks, and the last 7 days."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["status", "log"]},
                    "habit": {"type": "string", "enum": ["italian", "articulation", "speaking", "grooming"]},
                    "minutes": {"type": "integer"},
                    "notes": {"type": "string"},
                    "done_on": {"type": "string", "description": "YYYY-MM-DD, omit for today."},
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "italian",
            "description": (
                "Andrew's Italian tutor: an A1 flashcard deck with spaced repetition. "
                "operation=lesson introduces new cards (count, default 5); operation=review returns "
                "cards due today (quiz them one at a time, never showing the answer first); "
                "operation=grade records whether he got one right (italian, correct); "
                "operation=progress shows cards learned, due and not started."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["lesson", "review", "grade", "progress"]},
                    "count": {"type": "integer"},
                    "italian": {"type": "string", "description": "grade: the card's exact Italian text."},
                    "correct": {"type": "boolean", "description": "grade: whether Andrew got it right."},
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "speech_coach",
            "description": (
                "Measure a practice talk from its transcript: words per minute (when the length is "
                "known), filler words, hedges, sentence length, vocabulary range, repeated sentence "
                "openers, and the two things to fix next. Use it when Andrew does a speaking or "
                "pitch practice rep; pass duration_seconds if he said how long it was."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "transcript": {"type": "string", "description": "What Andrew said, verbatim."},
                    "duration_seconds": {"type": "number"},
                },
                "required": ["transcript"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github",
            "description": (
                "Open a real GitHub issue in Jarvis's own repo proposing a workflow, feature, "
                "fix, or improvement. This tracks the proposal as a real, actionable item — it "
                "does not write or deploy any code itself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "A short, clear issue title."},
                    "body": {
                        "type": "string",
                        "description": "The full proposal: what to build, why, and a rough plan.",
                    },
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "news_feed",
            "description": (
                "Get recent news headlines — defaults to potential market moves, AI tools/LLM "
                "updates, and shifts in hedge funds, private equity, venture capital, or the AI "
                "field, or pass a specific query."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Search query. Omit for the default market-moves/AI-tools-LLM/"
                            "hedge-fund-PE-VC-AI feed. When choosing your own query for a "
                            "general news request, prefer these same themes unless the user "
                            "asks about something else specifically."
                        ),
                    },
                    "page_size": {"type": "integer", "description": "Number of articles to return. Default 8."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "spotify",
            "description": (
                "Control Andrew's Spotify playback — check what's playing, play/pause/skip, "
                "queue a track, or search. Requires an active Spotify device to control playback "
                "(checking now-playing/state works regardless)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": [
                            "get_now_playing",
                            "get_player_state",
                            "play",
                            "pause",
                            "next",
                            "previous",
                            "queue",
                            "search",
                        ],
                    },
                    "track_uris": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Spotify track URIs to play, for the play operation. Omit to resume.",
                    },
                    "track_uri": {
                        "type": "string",
                        "description": "A single Spotify track URI, for the queue operation — from a "
                        "prior search result.",
                    },
                    "query": {"type": "string", "description": "Search text, for the search operation."},
                    "max_results": {"type": "integer", "description": "Result cap for search. Default 5."},
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "zoho_mail",
            "description": (
                "Read Andrew's Zoho Mail business inbox (andrew.thomas@kivaroai.com) — a "
                "completely separate mailbox from his connected Gmail (google_titan). Use to "
                "list recent inbox messages, search by sender/subject/keyword, or read a "
                "specific message's full body. Read-only — no send/reply capability."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["list_recent", "search", "get_content"],
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Result cap for list_recent/search. Default 10, max 200.",
                    },
                    "sender": {
                        "type": "string",
                        "description": "Filter by sender email or name, for the search operation.",
                    },
                    "subject": {
                        "type": "string",
                        "description": "Filter by subject text, for the search operation.",
                    },
                    "keyword": {
                        "type": "string",
                        "description": "Free-text search across the full email content, for the "
                        "search operation.",
                    },
                    "folder_id": {
                        "type": "string",
                        "description": "Zoho folderId, required for get_content — from a prior "
                        "list_recent/search result's folder_id field.",
                    },
                    "message_id": {
                        "type": "string",
                        "description": "Zoho messageId, required for get_content — from a prior "
                        "list_recent/search result's message_id field.",
                    },
                },
                "required": ["operation"],
            },
        },
    },
    FILES_SCHEMA,
    BROWSER_SCHEMA,
]

DISPATCH = {
    "database_agent": database_agent,
    "web_research": web_research,
    "market_analysis": market_analysis,
    "market_history": market_history,
    "google_titan": google_titan,
    "think": think,
    "calculator": calculator,
    "portfolio": portfolio,
    "company_financials": company_financials,
    "kivaro_pipeline": kivaro_pipeline,
    "launch_tracker": launch_tracker,
    "kiv_tasks": kiv_tasks,
    "habits": habits,
    "italian": italian,
    "speech_coach": speech_coach,
    "github": github,
    "news_feed": news_feed,
    "spotify": spotify,
    "zoho_mail": zoho_mail,
    "files": files,
    "browser": browser,
}
