-- Market and trading-signal updates in the inbox (app/services/
-- market_updates.py), beside what Jarvis's rounds file. Every 15 minutes:
-- a new K.I.V. signal scan, a top trade reaching its target or stop, and
-- big moves on the watchlist each become a notice, pushed to the devices.
--
-- jarvis_inbox gains a topic, so the inbox can be filtered: rounds (what
-- Jarvis's rounds filed), markets, or signals. jarvis_state is a small
-- key/value store for what has already been announced, so nothing is
-- said twice. Same default-deny RLS: only the service-role backend.

alter table public.jarvis_inbox
  add column topic text not null default 'rounds' check (topic in ('rounds', 'markets', 'signals'));

create table public.jarvis_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.jarvis_state enable row level security;

create or replace function public.jarvis_trigger_market_updates()
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
    url := 'https://jarvis-u49p.onrender.com/updates/run',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 120000
  );
end $$;

revoke all on function public.jarvis_trigger_market_updates() from public, anon, authenticated;

select cron.schedule('jarvis-market-updates', '*/15 * * * *', $$select public.jarvis_trigger_market_updates()$$);
