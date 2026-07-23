-- Jarvis's own Spotify OAuth connection (playback control). Genuinely
-- separate integration from Google — its own Developer app, its own
-- Client ID/Secret, its own refresh token. Same singleton-row shape as
-- jarvis_google_connection: Jarvis has no multi-user concept, so app code
-- always upserts against id='default'.

create table public.jarvis_spotify_connection (
  id text primary key default 'default',
  spotify_user_id text,
  display_name text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jarvis_spotify_connection enable row level security;
-- No policies defined on purpose, same as every other jarvis_ table:
-- service_role (what the FastAPI backend uses) bypasses RLS entirely.
