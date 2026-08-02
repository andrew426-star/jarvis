-- Jarvis's own Zoho Mail OAuth connection (read-only inbox access to
-- andrew.thomas@kivaroai.com). Genuinely separate integration from
-- Google/Gmail — its own Zoho API Console app, its own Client ID/Secret,
-- its own refresh token, its own mailbox. Same singleton-row shape as
-- jarvis_google_connection/jarvis_spotify_connection: Jarvis has no
-- multi-user concept, so app code always upserts against id='default'.
--
-- account_id and inbox_folder_id are resolved once at connect time (via
-- GET /api/accounts and GET /api/accounts/{accountId}/folders, right
-- after token exchange) and cached here so normal tool calls never need
-- extra API round trips to re-resolve them.

create table public.jarvis_zoho_connection (
  id text primary key default 'default',
  email_address text,
  account_id text,
  inbox_folder_id text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jarvis_zoho_connection enable row level security;
-- No policies defined on purpose, same as every other jarvis_ table:
-- service_role (what the FastAPI backend uses) bypasses RLS entirely.
