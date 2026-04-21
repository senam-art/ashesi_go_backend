-- 004: Friend-pay RPC.
--
-- Charges the PAYER's wallet (with the normal overdraft rule) but records
-- the boarding against the RIDER. The rider's total_rides counter grows,
-- the payer's wallet shrinks.

begin;

create or replace function public.handle_friend_boarding_transaction(
  p_payer_id          uuid,
  p_rider_id          uuid,
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
  if p_payer_id = p_rider_id then
    raise exception 'Use handle_boarding_transaction for self-pay.';
  end if;

  select coalesce(balance, 0)
    into v_balance
    from public.wallets
   where user_id = p_payer_id
   for update;

  if v_balance is null then
    raise exception 'Wallet not found for payer %', p_payer_id;
  end if;

  v_new_balance := v_balance - p_fare;
  if v_new_balance < -v_overdraft then
    raise exception 'Overdraft limit reached';
  end if;

  update public.wallets
     set balance = v_new_balance, updated_at = now()
   where user_id = p_payer_id;

  update public.profiles
     set wallet_balance = v_new_balance, updated_at = now()
   where id = p_payer_id;

  insert into public.boardings (passenger_id, active_journey_id, drop_off_stop_id, paid_by)
  values (p_rider_id, p_journey_id, p_drop_off_stop_id, p_payer_id);

  insert into public.transactions (user_id, amount, type, status, description, metadata)
  values (
    p_payer_id,
    p_fare,
    case when v_new_balance < 0 then 'fare_overdraft' else 'fare' end,
    'success',
    'Shuttle fare (friend-pay)',
    jsonb_build_object('paid_for', p_rider_id)
  );

  -- Credit ride count to the rider, not the payer.
  update public.profiles
     set total_rides = coalesce(total_rides, 0) + 1,
         updated_at  = now()
   where id = p_rider_id;

  return v_new_balance;
end;
$$;

commit;
