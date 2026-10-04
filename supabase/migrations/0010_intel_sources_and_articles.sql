-- Intel: the news behind Jarvis's Intel panel and K.I.V.'s Intel Hub, now
-- from one place. Shared by both apps (same Supabase project), so the two
-- show the same articles from the same vetted outlets.
--
-- intel_sources is the vetted outlet list. Each outlet carries its
-- published ratings (AllSides for lean, Media Bias/Fact Check for lean and
-- factual reporting) and why it is in or out. The rule, Oct 2026: keep an
-- outlet when at least one rater puts it at center or right of it and its
-- factual record is Mostly Factual or better; drop it when both put it left
-- of center, or its factual record is Mixed. Non-political trade outlets
-- are judged on their reporting. Disabled rows stay, with the reason.
--
-- intel_articles is what the hourly refresh found per Intel category
-- (app/services/intel.py): a few recent articles each, headline-matched to
-- the category, mixed across outlets. Replaced category by category.
-- Same default-deny RLS as the other tables: only service-role backends
-- (Jarvis, and K.I.V.'s admin client) read or write.

create table public.intel_sources (
  domain text primary key,
  name text not null,
  -- Which query group it is searched in: wire, markets, funds or tech.
  grp text not null check (grp in ('wire', 'markets', 'funds', 'tech')),
  enabled boolean not null default true,
  allsides text,
  mbfc_bias text,
  mbfc_factual text,
  note text,
  updated_at timestamptz not null default now()
);

alter table public.intel_sources enable row level security;

insert into public.intel_sources (domain, name, grp, enabled, allsides, mbfc_bias, mbfc_factual, note) values
  ('reuters.com', 'Reuters', 'wire', true, 'Center', 'Least Biased', 'Very High', null),
  ('wsj.com', 'The Wall Street Journal', 'wire', true, 'Center', 'Right-Center', 'Mostly Factual', null),
  ('ft.com', 'Financial Times', 'wire', true, 'Center', 'Least Biased', 'High', null),
  ('bloomberg.com', 'Bloomberg', 'wire', true, 'Center', 'Left-Center', 'Mostly Factual', 'Kept: AllSides rates it Center.'),
  ('barrons.com', 'Barron''s', 'markets', true, null, 'Right-Center', 'High', null),
  ('marketwatch.com', 'MarketWatch', 'markets', true, null, 'Right-Center', 'High', null),
  ('economist.com', 'The Economist', 'markets', true, null, 'Least Biased', 'High', null),
  ('financialpost.com', 'Financial Post', 'markets', true, null, 'Right-Center', 'Mostly Factual', null),
  ('fortune.com', 'Fortune', 'markets', true, null, 'Right-Center', 'High', null),
  ('washingtonexaminer.com', 'Washington Examiner', 'markets', true, null, 'Right-Center', 'Mostly Factual', null),
  ('realclearmarkets.com', 'RealClearMarkets', 'markets', true, null, 'Right-Center', 'Mostly Factual', null),
  ('pionline.com', 'Pensions & Investments', 'funds', true, null, 'Least Biased', 'Mostly Factual', null),
  ('institutionalinvestor.com', 'Institutional Investor', 'funds', true, null, null, null, 'Trade publication for asset owners and managers.'),
  ('hedgeweek.com', 'Hedgeweek', 'funds', true, null, null, null, 'Hedge fund trade publication.'),
  ('privateequityinternational.com', 'Private Equity International', 'funds', true, null, null, null, 'Private equity trade publication.'),
  ('pitchbook.com', 'PitchBook', 'funds', true, null, null, null, 'PE/VC data and news.'),
  ('techcrunch.com', 'TechCrunch', 'tech', true, 'Center', 'Left-Center', 'High', 'Kept: AllSides rates it Center (low confidence).'),
  ('theinformation.com', 'The Information', 'tech', true, null, null, 'High', 'Tech and venture trade reporting.'),
  ('venturebeat.com', 'VentureBeat', 'tech', true, null, null, null, 'Enterprise AI trade publication.'),
  ('news.crunchbase.com', 'Crunchbase News', 'tech', true, null, null, null, 'Funding-round data and news.'),
  ('cnbc.com', 'CNBC', 'markets', false, 'Lean Left', 'Left-Center', 'Mostly Factual', 'Dropped: both raters put it left of center (AllSides moved it to Lean Left, 2025).'),
  ('axios.com', 'Axios', 'markets', false, 'Lean Left', 'Left-Center', 'High', 'Dropped: both raters put it left of center.'),
  ('theverge.com', 'The Verge', 'tech', false, 'Lean Left', 'Left-Center', 'High', 'Dropped: both raters put it left of center.'),
  ('businessinsider.com', 'Business Insider', 'markets', false, null, null, null, 'Removed at Andrew''s request (Oct 2026).'),
  ('forbes.com', 'Forbes', 'markets', false, 'Center', 'Least Biased', 'Mostly Factual', 'Dropped: much of what surfaces is contributor content, which is what lowers its factual rating.'),
  ('foxbusiness.com', 'Fox Business', 'markets', false, 'Lean Right', 'Right-Center', 'Mixed', 'Dropped: Mixed factual reporting.'),
  ('investors.com', 'Investor''s Business Daily', 'markets', false, 'Lean Right', 'Right', 'Mixed', 'Dropped: Mixed factual reporting on its editorial side.'),
  ('thefp.com', 'The Free Press', 'markets', false, null, 'Right-Center', 'Mixed', 'Dropped: Mixed factual reporting.'),
  ('washingtontimes.com', 'The Washington Times', 'markets', false, null, 'Right-Center', 'Mixed', 'Dropped: Mixed factual reporting.'),
  ('nationalreview.com', 'National Review', 'markets', false, null, 'Right', 'Mostly Factual', 'Left out: an opinion magazine with little coverage of these segments.');

create table public.intel_articles (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  url text not null,
  source text not null,
  domain text not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);

create index intel_articles_category_idx on public.intel_articles (category, published_at desc);

alter table public.intel_articles enable row level security;

-- Hourly refresh: the routine token from 0006, sent to /intel/refresh.
create or replace function public.jarvis_trigger_intel()
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
    url := 'https://jarvis-u49p.onrender.com/intel/refresh',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 180000
  );
end $$;

revoke all on function public.jarvis_trigger_intel() from public, anon, authenticated;

select cron.schedule('jarvis-intel-refresh', '35 * * * *', $$select public.jarvis_trigger_intel()$$);
