-- Job-opening monitor — seen-job state. Run once in the Supabase SQL editor
-- (same project as the tracker). Only the monitor, using the service_role key,
-- reads/writes this table.

create table if not exists public.monitor_seen_jobs (
  id      text primary key,          -- company-namespaced posting key, e.g. "AstraZeneca:R-253572"
  company text not null default '',
  title   text not null default '',
  seen_at timestamptz not null default now()
);

-- RLS on with NO policies: anon and authenticated users get no access at all;
-- the service_role key (used only by the monitor) bypasses RLS.
alter table public.monitor_seen_jobs enable row level security;

-- The monitor connects as service_role; grant it access explicitly. Required
-- because "Automatically expose new tables" is off, so new tables don't
-- auto-grant to the API roles (service_role included).
grant usage on schema public to service_role;
grant all on public.monitor_seen_jobs to service_role;
