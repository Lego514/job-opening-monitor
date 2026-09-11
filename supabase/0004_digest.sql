-- Job-opening monitor — daily apply queue. Run once in the Supabase SQL editor
-- (same project as the tracker, 0002_monitor.sql and 0003_llm_verdicts.sql).
--
-- Two tables:
--
--   monitor_candidates — one snapshot per alertable posting, written by the
--     15-minute monitor run that first found it. This is what the daily digest
--     reads instead of re-fetching 22k postings from every ATS: the LLM verdict,
--     the USCIS sponsor history, the salary and the cap-exempt flag all exist
--     only in that run's memory otherwise (the tracker row keeps none of them).
--     `first_seen` is load-bearing — paired with `posted_days` it is what lets a
--     relative Workday age ("Posted 2 Days Ago") keep aging after capture.
--
--   monitor_digest — what each day's queue already showed, so tomorrow's picks
--     genuinely fresh roles instead of repeating today's.
--
-- Same access model as the other monitor tables: RLS on with no policies, and an
-- explicit grant to service_role (the only role that touches them).

create table if not exists public.monitor_candidates (
  id                 text primary key,         -- company-namespaced posting key
  company            text not null default '',
  title              text not null default '',
  location           text not null default '',
  url                text not null default '',
  posted_on          text not null default '', -- raw ATS text/date, for display
  posted_days        int,                      -- age in days AT CAPTURE (null = unparseable)
  salary             text,
  remote             boolean not null default false,
  cap_exempt         boolean not null default false,
  via                text,                     -- aggregator the row came from, if any
  sponsorship        text,                     -- 'no' | 'unknown' (regex JD scan)
  sponsorship_reason text,
  llm                jsonb,                    -- LlmVerdict (see src/types.ts)
  sponsor_history    jsonb,                    -- SponsorHistory (see src/sponsors.ts)
  first_seen         timestamptz not null default now()
);
-- The digest reads a trailing window of the pool, newest first.
create index if not exists monitor_candidates_first_seen_idx
  on public.monitor_candidates(first_seen desc);

create table if not exists public.monitor_digest (
  posting_key text primary key references public.monitor_candidates(id) on delete cascade,
  digested_on date not null,                   -- the America/New_York day it went out
  rank        int  not null default 0,         -- position in that day's queue (1 = top)
  created_at  timestamptz not null default now()
);
create index if not exists monitor_digest_day_idx on public.monitor_digest(digested_on desc);

alter table public.monitor_candidates enable row level security;
alter table public.monitor_digest     enable row level security;

-- "Automatically expose new tables" is off, so new tables don't auto-grant to
-- the API roles (service_role included) — grant explicitly.
grant usage on schema public to service_role;
grant all on public.monitor_candidates to service_role;
grant all on public.monitor_digest to service_role;
