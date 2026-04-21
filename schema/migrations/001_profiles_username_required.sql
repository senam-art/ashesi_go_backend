-- 001: Require username on profiles and enforce length/format.
--
-- Backfills any null usernames with a deterministic placeholder before
-- flipping the column to NOT NULL. Length check is 3..20 chars, lowercase
-- alphanumeric + underscore.

begin;

-- Backfill nulls with first-letter-of-first-name + short uuid suffix.
update public.profiles
   set username = lower(
         substr(coalesce(first_name, 'user'), 1, 1) ||
         replace(substr(id::text, 1, 8), '-', '')
       )
 where username is null;

-- Flip to NOT NULL.
alter table public.profiles
  alter column username set not null;

-- Enforce format (only if not already present).
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_username_format_chk'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_chk
      check (char_length(username) between 3 and 20
             and username ~ '^[a-z0-9_]+$');
  end if;
end $$;

commit;
