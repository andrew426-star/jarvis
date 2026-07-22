-- Jarvis's own Google OAuth connection (Gmail/Calendar/Drive/Docs), reusing
-- kiv-console's existing Google Cloud OAuth Client ID/Secret registration
-- but a fully separate consent grant — its own refresh token, its own
-- scopes, its own row here. Not the same connection as kiv-console's
-- calendar_connections table (different project surface, different
-- tokens), and Jarvis never reads/writes that table.
--
-- Single-row-in-practice: Jarvis has no multi-user concept, so this uses a
-- fixed singleton primary key ('default') instead of a profile_id foreign
-- key, and app code always upserts against id='default'.

create table public.jarvis_google_connection (
  id text primary key default 'default',
  google_email text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jarvis_google_connection enable row level security;
-- No policies defined on purpose, same as jarvis_contacts and
-- jarvis_interaction_log: service_role (what the FastAPI backend uses)
-- bypasses RLS entirely, so this is a deliberate default-deny for
-- anon/authenticated roles.
