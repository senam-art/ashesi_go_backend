-- 010: Record departure time from each stop on stop_visit_summaries.
--
-- When the driver hits the slider a second time (DEPART), we update the
-- latest row for that journey+stop so the timeline shows both arrival and
-- departure timestamps.

begin;

alter table public.stop_visit_summaries
  add column if not exists departed_at timestamptz;

commit;
