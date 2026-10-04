-- Every attempt at the console's lock (app/api/routes/unlock.py): PIN and
-- face unlocks, face enrolments, right or wrong, with where it came from.
-- The audit trail for "was that me?". A lockout, or a face enrolled, also
-- reaches Andrew at once as an urgent inbox notice under the new security
-- topic. Same default-deny RLS: only the service-role backend.

create table public.jarvis_auth_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  method text not null check (method in ('pin', 'face', 'enroll')),
  outcome text not null check (outcome in ('ok', 'wrong', 'locked', 'rejected')),
  detail text,
  ip text,
  user_agent text
);

create index jarvis_auth_events_at_idx on public.jarvis_auth_events (at desc);

alter table public.jarvis_auth_events enable row level security;

alter table public.jarvis_inbox drop constraint if exists jarvis_inbox_topic_check;
alter table public.jarvis_inbox
  add constraint jarvis_inbox_topic_check check (topic in ('rounds', 'markets', 'signals', 'security'));
