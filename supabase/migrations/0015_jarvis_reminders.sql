-- Reminders at a set time (app/tools/reminders.py): "remind me at three to
-- call Dr. Lee", or a standing one every weekday. Unlike the console's
-- timers they do not need the console open: every minute the scheduler
-- calls /reminders/run, which fires what is due as a push (it gets
-- through a "hold my calls") and an inbox notice under the new reminders
-- topic, and books the next one of anything that repeats. Same
-- default-deny RLS: only the service-role backend.
--
-- Apply after the code is deployed, like 0009 and 0012.

create table public.jarvis_reminders (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  due_at timestamptz not null,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekdays', 'weekly')),
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  fired_at timestamptz,
  created_at timestamptz not null default now()
);

create index jarvis_reminders_due_idx on public.jarvis_reminders (due_at) where status = 'pending';

alter table public.jarvis_reminders enable row level security;

alter table public.jarvis_inbox drop constraint if exists jarvis_inbox_topic_check;
alter table public.jarvis_inbox
  add constraint jarvis_inbox_topic_check check (topic in ('rounds', 'markets', 'signals', 'security', 'reminders'));

create or replace function public.jarvis_trigger_reminders()
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
    url := 'https://jarvis-u49p.onrender.com/reminders/run',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 30000
  );
end $$;

revoke all on function public.jarvis_trigger_reminders() from public, anon, authenticated;

select cron.schedule('jarvis-reminders', '* * * * *', $$select public.jarvis_trigger_reminders()$$);
