-- 002: Add drop_off_stop_id and paid_by to boardings/boarding_logs.
--
--   drop_off_stop_id  - the stop where the passenger plans to alight;
--                       used by the exit-count trigger (see 003).
--   paid_by           - non-null when a different user paid the fare
--                       (friend-pay). self-pay leaves it null.

begin;

alter table public.boardings
  add column if not exists drop_off_stop_id uuid references public.bus_stops(bus_stop_id),
  add column if not exists paid_by          uuid references public.profiles(id) on delete set null;

create index if not exists idx_boardings_dropoff
  on public.boardings (active_journey_id, drop_off_stop_id);

alter table public.boarding_logs
  add column if not exists drop_off_stop_id uuid references public.bus_stops(bus_stop_id),
  add column if not exists paid_by          uuid references public.profiles(id) on delete set null;

commit;
