-- 005: Extend self-pay RPC to persist drop_off_stop_id.
--
-- Replaces handle_boarding_transaction with a signature that accepts an
-- optional drop-off stop. Existing callers that pass only 3 args still work
-- because the new signature's p_drop_off_stop_id has a default.

begin;

create or replace function public.handle_boarding_transaction(
  p_passenger_id      uuid,
  p_journey_id        uuid,
  p_fare              numeric,
  p_drop_off_stop_id  uuid default null
)
returns numeric
language plpgsql
security definer
as $$
declare
  v_balance      numeric;
  v_new_balance  numeric;
  v_overdraft    numeric := 50.00;
begin
  select coalesce(balance, 0)
    into v_balance
    from public.wallets
   where user_id = p_passenger_id
   for update;

  if v_balance is null then
    raise exception 'Wallet not found for passenger %', p_passenger_id;
  end if;

  v_new_balance := v_balance - p_fare;
  if v_new_balance < -v_overdraft then
    raise exception 'Overdraft limit reached';
  end if;

  update public.wallets
     set balance = v_new_balance, updated_at = now()
   where user_id = p_passenger_id;

  update public.profiles
     set wallet_balance = v_new_balance,
         total_rides    = coalesce(total_rides, 0) + 1,
         updated_at     = now()
   where id = p_passenger_id;

  insert into public.boardings (passenger_id, active_journey_id, drop_off_stop_id)
  values (p_passenger_id, p_journey_id, p_drop_off_stop_id);

  insert into public.transactions (user_id, amount, type, status, description)
  values (
    p_passenger_id,
    p_fare,
    case when v_new_balance < 0 then 'fare_overdraft' else 'fare' end,
    'success',
    'Shuttle fare'
  );

  return v_new_balance;
end;
$$;

commit;
