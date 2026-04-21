-- 003: Decrement current_passenger_count when the driver reaches a stop.
--
-- Fires once per stop_visit_summaries row and decrements
-- active_journeys.current_passenger_count by the number of boardings
-- on that journey whose drop_off_stop_id matches the stop just visited.

begin;

create or replace function public.handle_passenger_exit_on_stop()
returns trigger
language plpgsql
as $$
declare
  v_exits integer;
begin
  select count(*)
    into v_exits
    from public.boardings
   where active_journey_id = new.active_journey_id
     and drop_off_stop_id  = new.stop_id;

  if v_exits > 0 then
    update public.active_journeys
       set current_passenger_count = greatest(coalesce(current_passenger_count, 0) - v_exits, 0)
     where act_jou_id = new.active_journey_id;

    update public.stop_visit_summaries
       set exited_at_this_stop   = v_exits,
           load_after_departure  = (
             select coalesce(current_passenger_count, 0)
               from public.active_journeys
              where act_jou_id = new.active_journey_id
           )
     where stop_visit_id = new.stop_visit_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_passenger_exit_on_stop on public.stop_visit_summaries;
create trigger trg_passenger_exit_on_stop
after insert on public.stop_visit_summaries
for each row execute function public.handle_passenger_exit_on_stop();

commit;
