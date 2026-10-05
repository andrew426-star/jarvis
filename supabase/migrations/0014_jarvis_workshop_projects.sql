-- Workshop projects: a build Andrew means to make, as one bundle - parts
-- from the Louisiana Tech catalog, wiring, the Arduino sketch (and its
-- compiled HEX), printed OpenSCAD parts and their 3D layout. Written whole
-- by Jarvis's project tool and the workshop's project panel
-- (app/tools/workshop_project.py), because a project is always read and
-- saved whole. Same default-deny RLS as the other jarvis_* tables: only
-- the service-role backend reads or writes.

create table public.jarvis_workshop_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jarvis_workshop_projects_updated_idx on public.jarvis_workshop_projects (updated_at desc);

alter table public.jarvis_workshop_projects enable row level security;
