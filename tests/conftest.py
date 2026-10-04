import copy
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

# The app reads its settings at import; tests never touch a real service.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
for key in [
    "GROQ_API_KEY", "TAVILY_API_KEY", "UPSTASH_REDIS_REST_TOKEN", "PINECONE_API_KEY", "FINNHUB_API_KEY",
    "NEWSAPI_KEY", "ALPACA_API_KEY_ID", "ALPACA_SECRET_KEY", "STRIPE_SECRET_KEY", "GITHUB_TOKEN",
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET", "SUPABASE_SERVICE_ROLE_KEY",
]:
    os.environ.setdefault(key, "test")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("UPSTASH_REDIS_REST_URL", "https://test.upstash.io")
os.environ["JARVIS_SESSION_SECRET"] = "s" * 64
os.environ["JARVIS_ALLOWED_EMAILS"] = "andrew@example.com"
os.environ["JARVIS_ACCESS_TOKEN"] = "script-token"


class _Query:
    """Enough of supabase-py's query builder for these tests, over lists of
    dicts: select, filters, order, limit, insert, update, upsert, delete."""

    def __init__(self, db: "FakeSupabase", table: str):
        self.db, self.table, self.filters = db, table, []
        self.op, self.payload, self._limit, self._order = "select", None, None, None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: r.get(key) == value)
        return self

    def neq(self, key, value):
        self.filters.append(lambda r: r.get(key) != value)
        return self

    def gte(self, key, value):
        self.filters.append(lambda r: (r.get(key) or "") >= value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values)
        return self

    def order(self, key, desc=False, nullsfirst=None):
        self._order = (key, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def upsert(self, payload):
        self.op, self.payload = "upsert", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        result = type("Result", (), {})()
        now = datetime.now(timezone.utc).isoformat()
        if self.op == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            made = []
            for p in payloads:
                row = {"id": str(uuid.uuid4()), "created_at": now, **self.db.defaults.get(self.table, {}), **copy.deepcopy(p)}
                rows.append(row)
                made.append(copy.deepcopy(row))
            result.data = made
            return result
        hits = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hits:
                r.update(copy.deepcopy(self.payload))
            result.data = copy.deepcopy(hits)
        elif self.op == "upsert":
            key = "id" if "id" in self.payload else "key" if "key" in self.payload else "endpoint"
            existing = [r for r in rows if r.get(key) == self.payload[key]]
            if existing:
                existing[0].update(copy.deepcopy(self.payload))
                result.data = copy.deepcopy(existing)
            else:
                rows.append(copy.deepcopy(self.payload))
                result.data = [copy.deepcopy(self.payload)]
        elif self.op == "delete":
            for r in hits:
                rows.remove(r)
            result.data = hits
        else:
            if self._order:
                key, desc = self._order
                hits.sort(key=lambda r: r.get(key) or "", reverse=desc)
            result.data = copy.deepcopy(hits[: self._limit] if self._limit else hits)
        return result


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.defaults = {
            "jarvis_inbox": {"status": "pending", "priority": "normal", "topic": "rounds"},
            "jarvis_checklists": {"archived": False, "updated_at": "2026-10-04T00:00:00+00:00"},
        }

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def db(monkeypatch):
    """A fresh in-memory Supabase, patched into every module that holds one."""
    fake = FakeSupabase()
    import importlib

    for module in [
        "app.core.supabase_client",
        "app.services.lock",
        "app.services.inbox",
        "app.services.push",
        "app.services.intel",
        "app.services.market_updates",
        "app.tools.checklist",
        "app.tools.trade_signals",
        "app.api.routes.unlock",
    ]:
        mod = importlib.import_module(module)
        if hasattr(mod, "get_supabase_client"):
            monkeypatch.setattr(mod, "get_supabase_client", lambda: fake)
    return fake
