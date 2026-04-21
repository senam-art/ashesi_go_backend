-- 007: Prevent duplicate UPCOMING active_journeys from the weekly cron.
--
-- The weekly generator (src/jobs/weeklyScheduleJob.js) materializes one
-- active_journey per recurring_schedule per day. We need a unique key on
-- (route_id, vehicle_id, driver_id, started_at) so reruns are no-ops.

begin;

create unique index if not exists idx_active_journeys_upcoming_unique
  on public.active_journeys (route_id, vehicle_id, driver_id, started_at)
  where status = 'UPCOMING';

commit;
