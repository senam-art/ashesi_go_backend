-- 011: add last_known_at so passengers can display a "X seconds ago" tag
-- next to the bus marker and decide whether the signal is fresh enough.

begin;

alter table public.active_journeys
  add column if not exists last_known_at timestamptz;

commit;
