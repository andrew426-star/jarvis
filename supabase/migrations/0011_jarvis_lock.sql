-- The console's lock (app/api/routes/unlock.py): a Google sign-in proves who
-- you are and then only opens the lock; the PIN (phone) or a face scan
-- (desktop) issues the short-lived unlock token the API accepts.
--
-- The PIN is never stored, only its scrypt hash and salt. The face is a set
-- of face descriptors (128 numbers each, from the console's scan) to match
-- against; no image is kept. Failed attempts lock the factor for a while,
-- longer each time. Same default-deny RLS as the other jarvis_* tables:
-- only the service-role backend reads or writes.

create table public.jarvis_lock (
  id text primary key default 'default',
  pin_hash text,
  pin_salt text,
  face_samples jsonb,
  face_enrolled_at timestamptz,
  pin_failures integer not null default 0,
  pin_locked_until timestamptz,
  face_failures integer not null default 0,
  face_locked_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.jarvis_lock (id) values ('default') on conflict (id) do nothing;

alter table public.jarvis_lock enable row level security;
