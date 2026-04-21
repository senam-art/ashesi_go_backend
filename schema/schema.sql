-- ============================================================================
-- Ashesi Go - Baseline Schema
-- ============================================================================
-- This file is the single source of truth for the current production schema.
-- Apply to a fresh database, then apply ./migrations/*.sql in numeric order.
--
-- Requires extensions: uuid-ossp, pgcrypto (installed by default on Supabase).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'role') then
    create type public.role as enum ('passenger', 'driver', 'admin');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- profiles  (mirror of auth.users, 1-to-1)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  first_name         text        not null,
  last_name          text        not null,
  username           text        unique,
  phone_number       text,
  role               public.role not null,
  total_rides        integer     default 0,
  wallet_balance     numeric(10, 2) default 0.00,
  profile_image_url  text,
  updated_at         timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- drivers  (extra driver-only fields; 1-to-1 with profiles of role='driver')
-- ---------------------------------------------------------------------------
create table if not exists public.drivers (
  driver_id                 uuid primary key references public.profiles(id) on delete cascade,
  username                  text        not null unique,
  first_name                text        not null,
  last_name                 text        not null,
  phone_number              text,
  requires_password_change  boolean     default true,
  is_verified               boolean     not null default false,
  created_at                timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- wallets
-- ---------------------------------------------------------------------------
create table if not exists public.wallets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.profiles(id) on delete cascade,
  balance    numeric(10, 2) not null default 0.00,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_wallets_user on public.wallets (user_id);

-- ---------------------------------------------------------------------------
-- routes
-- ---------------------------------------------------------------------------
create table if not exists public.routes (
  id                      uuid primary key default extensions.uuid_generate_v4(),
  route_name              text not null,
  description             text,
  encoded_polyline        text,
  polyline_fetched_at     timestamptz,
  route_distance_meters   integer,
  route_duration_seconds  integer,
  fare                    numeric(10, 2) not null default 5.00,
  created_at              timestamptz default (now() at time zone 'utc')
);

-- ---------------------------------------------------------------------------
-- bus_stops
-- ---------------------------------------------------------------------------
create table if not exists public.bus_stops (
  bus_stop_id    uuid primary key default extensions.uuid_generate_v4(),
  bus_stop_name  text not null unique,
  latitude       numeric(9, 6) not null,
  longitude      numeric(9, 6) not null,
  created_at     timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- route_structure  (M:N between routes and bus_stops, ordered)
-- ---------------------------------------------------------------------------
create table if not exists public.route_structure (
  route_id           uuid not null references public.routes(id)       on delete cascade,
  bus_stop_id        uuid not null references public.bus_stops(bus_stop_id) on delete cascade,
  stop_order         integer not null,
  scheduled_arrival  time,
  primary key (route_id, bus_stop_id)
);

create index if not exists idx_route_structure_route
  on public.route_structure (route_id, stop_order);

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------
create table if not exists public.vehicles (
  vehicle_id         uuid primary key default extensions.uuid_generate_v4(),
  license_plate      text not null unique,
  model              text default 'Toyota Coaster',
  sitting_capacity   integer default 30,
  standing_capacity  integer default 5,
  color_scheme       text,
  fuel_type          text default 'Diesel',
  created_at         timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- recurring_schedules  (weekly template)
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_schedules (
  schedule_id     uuid primary key default extensions.uuid_generate_v4(),
  route_id        uuid not null references public.routes(id) on delete cascade,
  driver_id       uuid         references public.profiles(id) on delete set null,
  vehicle_id      uuid         references public.vehicles(vehicle_id) on delete set null,
  day_of_week     integer not null check (day_of_week between 0 and 6),
  departure_time  time    not null,
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);

create index if not exists idx_schedules_day_time
  on public.recurring_schedules (day_of_week, departure_time);
create index if not exists idx_schedules_active
  on public.recurring_schedules (is_active);

-- ---------------------------------------------------------------------------
-- active_journeys  (one row per driver-trip attempt)
-- ---------------------------------------------------------------------------
create table if not exists public.active_journeys (
  act_jou_id               uuid primary key default extensions.uuid_generate_v4(),
  route_id                 uuid references public.routes(id),
  driver_id                uuid references public.profiles(id) on delete set null,
  vehicle_id               uuid references public.vehicles(vehicle_id),
  status                   text default 'UPCOMING' check (status in ('UPCOMING', 'ONGOING', 'COMPLETED')),
  current_passenger_count  integer default 0,
  current_lap              integer default 1,
  current_capacity         integer default 0,
  current_stop_index       integer default 0,
  last_known_lat           numeric(9, 6),
  last_known_lng           numeric(9, 6),
  started_at               timestamptz default now(),
  completed_at             timestamptz,
  created_at               timestamptz default now()
);

create index if not exists idx_active_journeys_status
  on public.active_journeys (status);
create index if not exists idx_active_journeys_driver
  on public.active_journeys (driver_id);
create index if not exists idx_active_journeys_created
  on public.active_journeys (created_at desc);

-- ---------------------------------------------------------------------------
-- boardings  (one row per NFC tap / QR scan)
-- ---------------------------------------------------------------------------
create table if not exists public.boardings (
  id                 uuid primary key default gen_random_uuid(),
  bus_id             text,
  passenger_id       uuid references public.profiles(id)       on delete set null,
  active_journey_id  uuid references public.active_journeys(act_jou_id) on delete cascade,
  boarded_at         timestamptz not null default now()
);

create index if not exists idx_boardings_student
  on public.boardings (passenger_id);
create index if not exists idx_boardings_journey
  on public.boardings (active_journey_id);
create index if not exists idx_boardings_boarded_at
  on public.boardings (boarded_at desc);

-- ---------------------------------------------------------------------------
-- boarding_logs  (audit of fare paid, separate from boardings for analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.boarding_logs (
  id            uuid primary key default extensions.uuid_generate_v4(),
  passenger_id  uuid not null references auth.users(id),
  journey_id    uuid not null references public.active_journeys(act_jou_id),
  fare_paid     numeric(10, 2) not null,
  boarded_at    timestamptz default now()
);

create index if not exists idx_boarding_passenger
  on public.boarding_logs (passenger_id);
create index if not exists idx_boarding_journey
  on public.boarding_logs (journey_id);

-- ---------------------------------------------------------------------------
-- stop_visit_summaries  (one row per driver arrive-at-stop event)
-- ---------------------------------------------------------------------------
create table if not exists public.stop_visit_summaries (
  stop_visit_id         uuid primary key default extensions.uuid_generate_v4(),
  active_journey_id     uuid references public.active_journeys(act_jou_id) on delete cascade,
  stop_id               uuid references public.bus_stops(bus_stop_id),
  route_id              uuid references public.routes(id) on delete set null,
  stop_name             text,
  route_name            text,
  arrival_time          timestamptz default now(),
  boarded_at_this_stop  integer default 0,
  exited_at_this_stop   integer default 0,
  load_after_departure  integer default 0,
  is_delayed            boolean default false,
  created_at            timestamptz default (now() at time zone 'utc')
);

create index if not exists idx_stop_visit_summaries_route_id
  on public.stop_visit_summaries (route_id);

-- ---------------------------------------------------------------------------
-- transactions  (wallet top-ups, fare deductions, overdrafts)
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      numeric(10, 2) not null,
  type        text not null check (type in ('top-up', 'fare', 'fare_overdraft')),
  status      text not null default 'pending' check (status in ('success', 'pending', 'failed')),
  reference   text unique,
  description text,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index if not exists idx_transactions_user
  on public.transactions (user_id);
create index if not exists idx_transactions_reference
  on public.transactions (reference);

-- ---------------------------------------------------------------------------
-- trip_logs  (raw analytics of every paid-board event)
-- ---------------------------------------------------------------------------
create table if not exists public.trip_logs (
  trip_log_id   uuid primary key default extensions.uuid_generate_v4(),
  journey_id    uuid references public.active_journeys(act_jou_id) on delete cascade,
  stop_id       uuid references public.bus_stops(bus_stop_id),
  passenger_id  uuid,
  lap_number    integer default 1,
  fare_paid     numeric(10, 2) default 5.00,
  created_at    timestamptz default now()
);
