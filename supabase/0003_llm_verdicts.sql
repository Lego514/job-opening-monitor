-- Job-opening monitor — cached LLM classification verdicts. Run once in the
-- Supabase SQL editor (same project as the tracker and 0002_monitor.sql).
--
-- Every row here is a Claude call already paid for. Without this table a re-run,
-- a re-seed, or a role that drops off a board and comes back would be billed
-- again; with it, the only postings that cost anything are the genuinely new
-- ones. Same shape and same access model as monitor_seen_jobs.

create table if not exists public.monitor_llm_verdicts (
  id         text primary key,          -- company-namespaced posting key, e.g. "AstraZeneca:R-253572"
  verdict    jsonb not null,            -- the LlmVerdict object (see src/types.ts)
  model      text not null default '',  -- model that produced it, so a model change is traceable
  created_at timestamptz not null default now()
);

-- RLS on with NO policies: anon and authenticated users get no access at all;
-- the service_role key (used only by the monitor) bypasses RLS.
alter table public.monitor_llm_verdicts enable row level security;

-- "Automatically expose new tables" is off, so new tables don't auto-grant to
-- the API roles (service_role included) — grant explicitly.
grant usage on schema public to service_role;
grant all on public.monitor_llm_verdicts to service_role;
