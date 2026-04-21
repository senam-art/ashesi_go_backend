-- ============================================================================
-- Ashesi Go - Triggers
-- ============================================================================
-- Apply after schema.sql and functions.sql. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: create wallet on profile creation
-- ---------------------------------------------------------------------------
drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
after insert on public.profiles
for each row execute function public.handle_new_profile();

-- ---------------------------------------------------------------------------
-- drivers: mirror driver details into profiles row
-- ---------------------------------------------------------------------------
drop trigger if exists on_driver_created on public.drivers;
create trigger on_driver_created
after insert on public.drivers
for each row execute function public.handle_driver_to_profile();

-- ---------------------------------------------------------------------------
-- boardings: +/- 1 on passenger count
-- ---------------------------------------------------------------------------
drop trigger if exists trg_sync_passenger_count on public.boardings;
create trigger trg_sync_passenger_count
after insert or delete on public.boardings
for each row execute function public.sync_passenger_count();

-- ---------------------------------------------------------------------------
-- transactions: wallet credit on success edge
-- ---------------------------------------------------------------------------
drop trigger if exists on_transaction_success on public.transactions;
create trigger on_transaction_success
after update on public.transactions
for each row execute function public.handle_wallet_increment();

-- ---------------------------------------------------------------------------
-- stop_visit_summaries: outbound bus-arrival webhook (FCM notification)
-- This trigger depends on supabase_functions.http_request, which is provided
-- by Supabase's Database Webhooks UI. Re-create via the Supabase dashboard
-- if missing. Left here for documentation.
-- ---------------------------------------------------------------------------
-- create trigger notify_bus_arrival
-- after insert on public.stop_visit_summaries
-- for each row
-- execute function supabase_functions.http_request(
--   'https://ashesi-go-app-9fh8f.ondigitalocean.app/api/scheduler/webhooks/bus-arrival',
--   'POST',
--   '{"Content-type":"application/json"}',
--   '{}',
--   '5000'
-- );
