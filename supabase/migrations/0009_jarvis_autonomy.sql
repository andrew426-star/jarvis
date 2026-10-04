-- Jarvis on his own: "rounds" every two hours, where he looks over
-- Andrew's projects, tasks, calendar and mail without being asked
-- (app/services/autonomy.py). He may read anything; anything that would
-- change something comes back as a proposal Andrew approves or declines,
-- from the inbox on the desktop console or the phone. Worth-knowing
-- findings come back as notices. Either can be pushed to his devices.
-- Same default-deny RLS as the other jarvis_* tables: only the
-- service-role backend reads or writes.

-- What rounds found. kind 'notice' is information; kind 'proposal' is an
-- action (one tool call, `tool` + `args`) held until Andrew decides.
create table public.jarvis_inbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notice', 'proposal')),
  title text not null,
  body text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  tool text,
  args jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'done', 'failed', 'dismissed')),
  result jsonb,
  -- The rounds session it came from ("rounds-2026-10-04"), for history.
  session_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (kind = 'notice' or tool is not null)
);

create index jarvis_inbox_pending_idx on public.jarvis_inbox (created_at desc) where status = 'pending';

alter table public.jarvis_inbox enable row level security;

-- Web Push subscriptions: one per device that switched notifications on
-- (the phone's home-screen app, a desktop browser).
create table public.jarvis_push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);

alter table public.jarvis_push_subscriptions enable row level security;

-- Rounds on or off, and the hours (Central) he keeps quiet.
create table public.jarvis_autonomy (
  id text primary key default 'default',
  enabled boolean not null default true,
  quiet_start smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 8 check (quiet_end between 0 and 23),
  last_round_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.jarvis_autonomy (id) values ('default') on conflict (id) do nothing;

alter table public.jarvis_autonomy enable row level security;

-- The trigger: the routine token from 0006, sent to /autonomy/rounds. The
-- backend skips quiet hours (in Central time) and rounds too close to the
-- last one, so the schedule can stay simple and UTC.
create or replace function public.jarvis_trigger_rounds()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'jarvis_routine_trigger_token';

  return net.http_post(
    url := 'https://jarvis-u49p.onrender.com/autonomy/rounds',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 300000
  );
end $$;

revoke all on function public.jarvis_trigger_rounds() from public, anon, authenticated;

select cron.schedule('jarvis-rounds',       '5 */2 * * *',  $$select public.jarvis_trigger_rounds()$$);
-- Backup call, in case Render was asleep and the first one timed out; the
-- backend runs at most one round per 90 minutes.
select cron.schedule('jarvis-rounds-retry', '15 */2 * * *', $$select public.jarvis_trigger_rounds()$$);
