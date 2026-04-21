-- 009: Expand transactions.status to match Paystack's full status set and
--      add verified_at for clean auditing.
--
-- Paystack verify responses can surface:
--   abandoned | failed | ongoing | pending | processing | queued
--   | reversed | success
-- The existing constraint only allowed 3 of these. We accept all 8.

begin;

alter table public.transactions
  drop constraint if exists transactions_status_check;

alter table public.transactions
  add constraint transactions_status_check
  check (status in (
    'pending', 'processing', 'ongoing', 'queued',
    'success', 'failed', 'abandoned', 'reversed'
  ));

alter table public.transactions
  add column if not exists verified_at timestamptz;

commit;
