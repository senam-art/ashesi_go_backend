-- 008: vehicle_tags  - NFC UID to vehicle_id mapping.
--
-- Supports NFC fallback when a tag is not NDEF-formatted. The Flutter app
-- reads the raw tag UID, POSTs it to /api/passenger/resolve-tag, and the
-- backend looks up the vehicle here.
--
-- uid_hash is sha256(UID) to avoid storing raw identifiers if desired;
-- clients may send either the raw UID (backend hashes) or the hash.

begin;

create table if not exists public.vehicle_tags (
  tag_id       uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(vehicle_id) on delete cascade,
  uid_hash     text not null unique,
  label        text,
  is_active    boolean not null default true,
  created_at   timestamptz default now()
);

create index if not exists idx_vehicle_tags_vehicle
  on public.vehicle_tags (vehicle_id);

commit;
