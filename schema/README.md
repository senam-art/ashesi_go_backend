# Ashesi Go — Database Schema

Canonical SQL for the Ashesi Go Supabase database. Apply in this order:

1. `schema.sql`       – tables, enums, indexes (baseline).
2. `functions.sql`    – stored functions / RPCs.
3. `triggers.sql`     – wire the functions onto tables.
4. `policies.sql`     – RLS (placeholder).
5. `migrations/*.sql` – forward-only, applied in numeric order.

## Applying locally

Using the Supabase CLI against a linked project:

```bash
psql "$DATABASE_URL" -f schema/schema.sql
psql "$DATABASE_URL" -f schema/functions.sql
psql "$DATABASE_URL" -f schema/triggers.sql
psql "$DATABASE_URL" -f schema/policies.sql
for f in schema/migrations/*.sql; do
  echo "Applying $f"
  psql "$DATABASE_URL" -f "$f"
done
```

## Applying on Supabase (dashboard)

Paste each file into **SQL Editor → New query** in the listed order. Every
script is idempotent (uses `if not exists`, `create or replace`, guarded
`do $$` blocks) so re-running is safe.

## Migrations

New migrations must:

- Be numbered with a zero-padded 3-digit prefix (`010_…`, `011_…`).
- Be wrapped in a single `begin; … commit;` where practical.
- Be idempotent.
- Be small and reviewable — one logical change per file.

Never edit an applied migration; write a new one that undoes or amends.
