-- The sentinel (app/services/sentinel.py): Jarvis's standing watch on the
-- news he follows, his new mail, and how Kivaro AI's posts are received.
-- Every 20 minutes the scheduler calls /sentinel/run, which files what
-- matters in the inbox under three new topics: intel, mail, publicity.
--
-- jarvis_publicity holds the posts whose reception is measured: the
-- platform's numbers at the last look (likes, upvotes, views, comments)
-- and which comments have been read, so only new ones are analysed.
-- Same default-deny RLS: only the service-role backend.
--
-- Apply after the code is deployed, like 0009, 0012 and 0015.

create table public.jarvis_publicity (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  platform text not null,
  title text,
  metrics jsonb not null default '{}'::jsonb,
  comments_seen jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.jarvis_publicity enable row level security;

alter table public.jarvis_inbox drop constraint if exists jarvis_inbox_topic_check;
alter table public.jarvis_inbox
  add constraint jarvis_inbox_topic_check check (
    topic in ('rounds', 'markets', 'signals', 'security', 'reminders', 'intel', 'mail', 'publicity')
  );

create or replace function public.jarvis_trigger_sentinel()
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
    url := 'https://jarvis-u49p.onrender.com/sentinel/run',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 120000
  );
end $$;

revoke all on function public.jarvis_trigger_sentinel() from public, anon, authenticated;

select cron.schedule('jarvis-sentinel', '*/20 * * * *', $$select public.jarvis_trigger_sentinel()$$);
