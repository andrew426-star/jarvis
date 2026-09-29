-- Founder-development tracking for Jarvis: daily habit check-ins
-- (app/tools/habits.py) and an Italian flashcard deck with Leitner-box
-- spaced repetition (app/tools/italian.py). Same default-deny RLS as the
-- other jarvis_* tables: only the service-role backend reads or writes.

create table public.jarvis_habit_log (
  id uuid primary key default gen_random_uuid(),
  habit text not null,
  done_on date not null,
  minutes integer,
  notes text,
  created_at timestamptz not null default now(),
  unique (habit, done_on)
);

create index jarvis_habit_log_done_on_idx on public.jarvis_habit_log (done_on desc);

alter table public.jarvis_habit_log enable row level security;

create table public.jarvis_italian_cards (
  italian text primary key,
  english text not null,
  -- Leitner box 1-5: a correct answer moves a card up one box and pushes
  -- its next review further out; a miss drops it back to box 1.
  box integer not null default 1 check (box between 1 and 5),
  due_on date not null default current_date,
  correct integer not null default 0,
  wrong integer not null default 0,
  last_reviewed_on date,
  created_at timestamptz not null default now()
);

create index jarvis_italian_cards_due_on_idx on public.jarvis_italian_cards (due_on);

alter table public.jarvis_italian_cards enable row level security;
