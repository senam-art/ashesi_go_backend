-- ============================================================================
-- 012_payment_methods.sql
-- ============================================================================
-- Payment methods saved per user. Two flavours:
--   * card   — never stores PAN/CVV. Only Paystack tokens + last4/brand.
--              Rows are auto-inserted by the verifyPayment controller when
--              Paystack returns a reusable authorization_code.
--   * momo   — phone number + mobile-money network (MTN/VODAFONE/AIRTELTIGO).
--              Users enter these manually from the client.
--
-- Exactly one row per user may have is_default = true (enforced via partial
-- unique index rather than a check, so updates are atomic).
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_method_type') then
    create type public.payment_method_type as enum ('card', 'momo');
  end if;
end $$;

create table if not exists public.payment_methods (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  type                 public.payment_method_type not null,
  label                text,

  -- card fields (nullable)
  last4                text,
  brand                text,          -- visa, mastercard, ...
  bank                 text,
  exp_month            text,
  exp_year             text,
  authorization_code   text,          -- Paystack token, used for charge_authorization

  -- momo fields (nullable)
  phone_number         text,
  network              text,          -- MTN, VOD, ATL ...

  is_default           boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint payment_methods_card_shape check (
    type <> 'card' or (last4 is not null and authorization_code is not null)
  ),
  constraint payment_methods_momo_shape check (
    type <> 'momo' or (phone_number is not null and network is not null)
  )
);

create index if not exists idx_payment_methods_user
  on public.payment_methods (user_id);

-- Only one default per user. NULLs don't conflict, so non-default rows coexist.
create unique index if not exists uq_payment_methods_user_default
  on public.payment_methods (user_id)
  where is_default = true;

-- Cards are unique by authorization_code per user (idempotent upsert target).
create unique index if not exists uq_payment_methods_user_auth_code
  on public.payment_methods (user_id, authorization_code)
  where authorization_code is not null;

-- MoMo is unique by (phone, network) per user so we don't dup on add.
create unique index if not exists uq_payment_methods_user_phone_network
  on public.payment_methods (user_id, phone_number, network)
  where phone_number is not null and network is not null;

-- touch updated_at
create or replace function public.payment_methods_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_payment_methods_touch on public.payment_methods;
create trigger trg_payment_methods_touch
  before update on public.payment_methods
  for each row execute function public.payment_methods_touch_updated_at();

-- RLS: owner read/write. Service role bypasses RLS, so the backend still works.
alter table public.payment_methods enable row level security;

drop policy if exists payment_methods_select_self on public.payment_methods;
create policy payment_methods_select_self
  on public.payment_methods for select
  using (auth.uid() = user_id);

drop policy if exists payment_methods_modify_self on public.payment_methods;
create policy payment_methods_modify_self
  on public.payment_methods for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
