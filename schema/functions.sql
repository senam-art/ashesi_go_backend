-- ============================================================================
-- Ashesi Go - Stored Functions
-- ============================================================================
-- Apply after schema.sql. Idempotent (create or replace).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- handle_new_profile
--   Called after INSERT on public.profiles. Creates the matching wallet row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.wallets (user_id, balance)
  values (new.id, coalesce(new.wallet_balance, 0.00))
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- handle_driver_to_profile
--   Called after INSERT on public.drivers. Ensures the matching profile row
--   has role='driver' and the username/name fields mirrored.
-- ---------------------------------------------------------------------------
create or replace function public.handle_driver_to_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.profiles
     set role       = 'driver',
         first_name = new.first_name,
         last_name  = new.last_name,
         username   = coalesce(new.username, username),
         phone_number = coalesce(new.phone_number, phone_number),
         updated_at = now()
   where id = new.driver_id;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_passenger_count
--   Trigger on boardings INSERT/DELETE.
--   Adjusts active_journeys.current_passenger_count by +/- 1.
-- ---------------------------------------------------------------------------
create or replace function public.sync_passenger_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.active_journeys
       set current_passenger_count = coalesce(current_passenger_count, 0) + 1
     where act_jou_id = new.active_journey_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.active_journeys
       set current_passenger_count = greatest(coalesce(current_passenger_count, 0) - 1, 0)
     where act_jou_id = old.active_journey_id;
    return old;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- handle_wallet_increment
--   Trigger on transactions UPDATE. Credits the wallet when a top-up
--   transitions from non-success into 'success'. Idempotency backstop.
-- ---------------------------------------------------------------------------
create or replace function public.handle_wallet_increment()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only credit on the success-edge and only for top-ups.
  if new.type = 'top-up'
     and new.status = 'success'
     and coalesce(old.status, '') <> 'success' then

    update public.wallets
       set balance    = coalesce(balance, 0) + new.amount,
           updated_at = now()
     where user_id = new.user_id;

    update public.profiles
       set wallet_balance = coalesce(wallet_balance, 0) + new.amount,
           updated_at = now()
     where id = new.user_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- handle_boarding_transaction
--   RPC: called by the Node backend /passenger/board endpoint.
--   Deducts fare from the passenger's wallet (allowing up to GHS 50 overdraft)
--   and inserts a boardings row.
--   Returns the passenger's new balance.
--
--   Signature extended in migration 005 to accept p_drop_off_stop_id.
--   This baseline keeps the legacy signature; the migration replaces it.
-- ---------------------------------------------------------------------------
create or replace function public.handle_boarding_transaction(
  p_passenger_id uuid,
  p_journey_id   uuid,
  p_fare         numeric
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
     set balance    = v_new_balance,
         updated_at = now()
   where user_id = p_passenger_id;

  update public.profiles
     set wallet_balance = v_new_balance,
         updated_at     = now()
   where id = p_passenger_id;

  insert into public.boardings (passenger_id, active_journey_id)
  values (p_passenger_id, p_journey_id);

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
