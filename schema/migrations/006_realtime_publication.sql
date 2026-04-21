-- 006: Enable Realtime Postgres Changes for trip-state tables.
--
-- Lets the Flutter passenger app subscribe to:
--   - active_journeys INSERT (trip started)
--   - active_journeys UPDATE (status=COMPLETED, location)
--   - stop_visit_summaries INSERT (bus arriving at stop)
--
-- Safe to re-run: each `add table` is guarded.

do $$
declare
  pubname text := 'supabase_realtime';
begin
  if not exists (select 1 from pg_publication where pubname = pubname) then
    -- Supabase creates this publication on bootstrap; if missing, create.
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = pubname
       and schemaname = 'public'
       and tablename = 'active_journeys'
  ) then
    alter publication supabase_realtime add table public.active_journeys;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = pubname
       and schemaname = 'public'
       and tablename = 'stop_visit_summaries'
  ) then
    alter publication supabase_realtime add table public.stop_visit_summaries;
  end if;
end $$;
