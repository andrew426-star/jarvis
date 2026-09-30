-- Jarvis's routine emails, scheduled by Supabase (pg_cron + pg_net) instead
-- of GitHub Actions. GitHub runs scheduled workflows best-effort and once
-- started an 8:30pm check-in at 2:11am; pg_cron fires on the minute.
--
-- Authentication without a shared secret leaving the database: a random
-- trigger token is generated here, kept in Vault for pg_cron to send, and
-- only its SHA-256 is stored where the Jarvis backend can read it
-- (app/core/auth.py, require_routine_access). The token itself never
-- appears in this file, the migration history, the repo or the backend's
-- config.
--
-- pg_cron runs in UTC with no time zones, so, exactly as the GitHub
-- workflow did, each routine is scheduled at its Central time for both
-- daylight (UTC-5) and standard (UTC-6) time, and passes the slot's cron;
-- /routines/<name>/run runs only the one matching Central's current offset
-- (app/api/routes/brief.py utc_cron). Each also has a backup call ten
-- minutes later, in case Render was asleep and the first one timed out;
-- the route sends at most once per slot. Keep these in step with brief.py:
-- scripts/check_routine_schedules.py checks.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.jarvis_routine_trigger (
  id text primary key default 'default',
  token_sha256 text not null,
  created_at timestamptz not null default now()
);
-- No policies: only the service role (which bypasses RLS) can read it.
alter table public.jarvis_routine_trigger enable row level security;

do $$
declare
  token text;
begin
  if not exists (select 1 from vault.secrets where name = 'jarvis_routine_trigger_token') then
    token := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(
      token,
      'jarvis_routine_trigger_token',
      'Bearer token pg_cron sends to trigger Jarvis routines'
    );
    insert into public.jarvis_routine_trigger (id, token_sha256)
    values ('default', encode(extensions.digest(token, 'sha256'), 'hex'))
    on conflict (id) do update set token_sha256 = excluded.token_sha256, created_at = now();
  end if;
end $$;

create or replace function public.jarvis_trigger_routine(routine text, slot_cron text)
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
    url := 'https://jarvis-u49p.onrender.com/routines/' || routine || '/run',
    params := jsonb_build_object('schedule', slot_cron),
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    -- Render's free instance can take a minute to wake, and a routine is a
    -- full agent turn; give it room.
    timeout_milliseconds := 300000
  );
end $$;

revoke all on function public.jarvis_trigger_routine(text, text) from public, anon, authenticated;

-- routine | slot cron (as brief.py computes it) | fires at
select cron.schedule('jarvis-morning-brief-cdt',        '0 12 * * *',  $$select public.jarvis_trigger_routine('morning-brief', '0 12 * * *')$$);
select cron.schedule('jarvis-morning-brief-cdt-retry',  '10 12 * * *', $$select public.jarvis_trigger_routine('morning-brief', '0 12 * * *')$$);
select cron.schedule('jarvis-morning-brief-cst',        '0 13 * * *',  $$select public.jarvis_trigger_routine('morning-brief', '0 13 * * *')$$);
select cron.schedule('jarvis-morning-brief-cst-retry',  '10 13 * * *', $$select public.jarvis_trigger_routine('morning-brief', '0 13 * * *')$$);

select cron.schedule('jarvis-evening-checkin-cdt',       '30 1 * * *', $$select public.jarvis_trigger_routine('evening-checkin', '30 1 * * *')$$);
select cron.schedule('jarvis-evening-checkin-cdt-retry', '40 1 * * *', $$select public.jarvis_trigger_routine('evening-checkin', '30 1 * * *')$$);
select cron.schedule('jarvis-evening-checkin-cst',       '30 2 * * *', $$select public.jarvis_trigger_routine('evening-checkin', '30 2 * * *')$$);
select cron.schedule('jarvis-evening-checkin-cst-retry', '40 2 * * *', $$select public.jarvis_trigger_routine('evening-checkin', '30 2 * * *')$$);

select cron.schedule('jarvis-weekly-review-cdt',        '0 22 * * 0',  $$select public.jarvis_trigger_routine('weekly-review', '0 22 * * 0')$$);
select cron.schedule('jarvis-weekly-review-cdt-retry',  '10 22 * * 0', $$select public.jarvis_trigger_routine('weekly-review', '0 22 * * 0')$$);
select cron.schedule('jarvis-weekly-review-cst',        '0 23 * * 0',  $$select public.jarvis_trigger_routine('weekly-review', '0 23 * * 0')$$);
select cron.schedule('jarvis-weekly-review-cst-retry',  '10 23 * * 0', $$select public.jarvis_trigger_routine('weekly-review', '0 23 * * 0')$$);
