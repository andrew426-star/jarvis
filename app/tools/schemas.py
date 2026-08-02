from app.tools.calculator import calculator
from app.tools.company_financials import company_financials
from app.tools.database_agent import database_agent
from app.tools.github import github
from app.tools.google_titan import google_titan
from app.tools.kivaro_pipeline import kivaro_pipeline
from app.tools.market_analysis import market_analysis
from app.tools.market_history import market_history
from app.tools.news_feed import news_feed
from app.tools.portfolio import portfolio
from app.tools.spotify import spotify
from app.tools.think import think
from app.tools.web_research import web_research
from app.tools.zoho_mail import zoho_mail

# Groq/OpenAI-shaped tool declarations for chat.completions.create(tools=...).
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
                "Andrew's connected Google account — Gmail, Calendar, Drive, and Docs. Use to "
                "list/search/read/send Gmail messages, list/create Calendar events, search "
                "Drive files by name or content, and create/read Google Docs."
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
                "Get recent news headlines — defaults to Fintech/AI-automation/alternative-"
                "investment topics, or pass a specific query."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query. Omit for the default Fintech/AI/alt-investment feed.",
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
    "github": github,
    "news_feed": news_feed,
    "spotify": spotify,
    "zoho_mail": zoho_mail,
}
