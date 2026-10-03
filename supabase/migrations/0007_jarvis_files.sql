-- Andrew's linked local folders (his CSC 1013 Python projects, say): a
-- read-only copy of their code and text files, kept in step by the console
-- while it is open (web/src/lib/linked-folders.ts -> POST /files/sync) and
-- read by Jarvis's files tool (app/tools/files.py). Jarvis's backend runs
-- in the cloud and cannot see the PC's disk; this copy is how he reads it.
-- Same default-deny RLS as the other jarvis_* tables: only the
-- service-role backend reads or writes.

create table public.jarvis_files (
  folder text not null,
  -- Relative to the folder, with forward slashes: "lab3/main.py".
  path text not null,
  content text not null,
  size integer not null,
  modified_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (folder, path)
);

alter table public.jarvis_files enable row level security;
