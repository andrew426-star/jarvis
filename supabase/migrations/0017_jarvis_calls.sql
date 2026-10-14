-- The phone line (app/services/phone.py, app/api/routes/phone.py): every
-- call Jarvis screens and every text, with who it was, what it was about
-- as he understood it, what happened (screening, ringing, accepted,
-- message, missed, spam, done) and any voicemail's transcript. Voicemails,
-- missed calls and texts also reach the inbox under the new calls topic.
-- Same default-deny RLS: only the service-role backend.

create table public.jarvis_calls (
  id uuid primary key default gen_random_uuid(),
  sid text not null unique,
  kind text not null default 'call' check (kind in ('call', 'sms')),
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  from_number text,
  caller text,
  reason text,
  status text,
  transcript text,
  recording_url text,
  created_at timestamptz not null default now()
);

create index jarvis_calls_created_idx on public.jarvis_calls (created_at desc);

alter table public.jarvis_calls enable row level security;

alter table public.jarvis_inbox drop constraint if exists jarvis_inbox_topic_check;
alter table public.jarvis_inbox
  add constraint jarvis_inbox_topic_check check (
    topic in ('rounds', 'markets', 'signals', 'security', 'reminders', 'intel', 'mail', 'publicity', 'calls')
  );
