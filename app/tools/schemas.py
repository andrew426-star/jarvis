from app.tools.database_agent import database_agent
from app.tools.web_research import web_research

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
]

DISPATCH = {
    "database_agent": database_agent,
    "web_research": web_research,
}
