-- Job-opening monitor — per-source health across runs. Run once in the
-- Supabase SQL editor (same project as 0002_monitor.sql).
--
-- One row per source, overwritten every run. `consecutive_failures` is what turns
-- "this source failed once" (noise: a blip, a deploy on their side) into "this
-- source has been down for an hour" (an alert). Until this table exists the run
-- still prints and publishes its per-run health report; it just can't count
-- failures across runs.

create table if not exists public.monitor_source_health (
  source               text primary key,     -- source name from src/config.ts
  consecutive_failures integer not null default 0,
  last_ok_at           timestamptz,
  last_failure_at      timestamptz,
  last_failure_layer   text,                 -- dns | tcp | tls | timeout | rate_limited | http_4xx | http_5xx | parse | unknown
  last_p95_ms          integer,              -- p95 response time of the last run that got an answer
  updated_at           timestamptz not null default now()
);

-- Same access model as the other monitor tables: RLS on with no policies, so
-- only the service_role key (used only by the monitor) can read or write.
alter table public.monitor_source_health enable row level security;

grant usage on schema public to service_role;
grant all on public.monitor_source_health to service_role;
