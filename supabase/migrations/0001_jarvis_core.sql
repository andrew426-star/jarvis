-- Jarvis's own tables in the shared kiv-console Supabase project
-- (jibzwugivnktfesbrqcd). All jarvis_-prefixed to read unambiguously as
-- Jarvis's, distinct from kiv-console's own tables and from the earlier,
-- now-discarded Jarvis attempt's leftover `user_profile` table (not
-- touched, not reused, not repurposed).

create table public.jarvis_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  relationship text not null default 'other'
    check (relationship = any (array['family', 'friend', 'colleague', 'client', 'investor', 'other'])),
  email text,
  phone text,
  notes text,
  tags text[] not null default '{}',
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jarvis_contacts_name_idx on public.jarvis_contacts (lower(name));

alter table public.jarvis_contacts enable row level security;
-- No policies defined on purpose: service_role (what the FastAPI backend
-- uses) bypasses RLS entirely, so this is a deliberate default-deny for
-- anon/authenticated roles, matching every existing table in this project.

create table public.jarvis_interaction_log (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_message text not null,
  assistant_response text,
  tools_used text[] not null default '{}',
  tool_call_trace jsonb not null default '[]',
  model text not null,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index jarvis_interaction_log_session_id_idx on public.jarvis_interaction_log (session_id);
create index jarvis_interaction_log_created_at_idx on public.jarvis_interaction_log (created_at desc);

alter table public.jarvis_interaction_log enable row level security;
