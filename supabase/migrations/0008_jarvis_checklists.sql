-- Quick checklists Jarvis makes from a note or a spoken brain-dump
-- ("groceries: milk, eggs, call mum about Sunday"), written by his
-- checklist tool (app/tools/checklist.py) and ticked off from the chat on
-- the desktop console or the phone (POST /checklists/{id}/items/{item}).
-- Items live in one jsonb array, [{id, text, done}], because a list is
-- always read and written whole. Same default-deny RLS as the other
-- jarvis_* tables: only the service-role backend reads or writes.

create table public.jarvis_checklists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  items jsonb not null default '[]'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jarvis_checklists_open_idx on public.jarvis_checklists (updated_at desc) where not archived;

alter table public.jarvis_checklists enable row level security;
