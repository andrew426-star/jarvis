from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_supabase_client() -> Client:
    settings = get_settings()
    # Service-role key — bypasses RLS entirely. Never expose this outside
    # this backend (mirrors kiv-console's src/lib/supabase/admin.ts intent).
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
