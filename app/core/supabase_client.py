import threading

from supabase import Client, create_client

from app.core.config import get_settings

# One client per thread, not one per process. The client talks HTTP/2 over
# a single connection, and that connection is not safe to use from two
# threads at once: tools run in parallel (orchestrator._TOOL_EXECUTOR,
# eight threads), and when several hit Supabase together the connection's
# state is corrupted ("ConnectionTerminated error_code:9") and every later
# call on it fails. Rounds, which read seven sources at once, failed whole.
# Each thread keeps its own client, made on first use and reused after.
_local = threading.local()


def get_supabase_client() -> Client:
    client = getattr(_local, "client", None)
    if client is None:
        settings = get_settings()
        # Service-role key — bypasses RLS entirely. Never expose this outside
        # this backend (mirrors kiv-console's src/lib/supabase/admin.ts intent).
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        _local.client = client
    return client
