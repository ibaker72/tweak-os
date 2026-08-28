-- ============================================================================
-- 00017_commission_accrual.sql
--
-- Database-level support for the accrual engine (src/lib/commissions):
--   1. Idempotency that does not depend on the application reading first.
--   2. The one UPDATE admins need in order to batch entries for payout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. One earned entry per payment, enforced by the database
--
-- The engine is idempotent by construction — it compares planned entries
-- against what is already in the ledger — but a read-then-write check races
-- with itself if two sweeps overlap (a cron run and a manual sweep, say).
-- This index makes a double-pay impossible rather than unlikely.
--
-- Clawbacks are deliberately not covered: a refund can grow in stages, and
-- each increment is its own reversing row. Those are kept idempotent by the
-- planner, which only ever writes the delta not yet clawed back.
-- ---------------------------------------------------------------------------

create unique index if not exists uq_commission_entries_earned_per_payment
  on public.commission_entries (payment_id)
  where entry_type = 'earned' and payment_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Let admins stamp entries into a payout batch
--
-- 00016 gave commission_entries only SELECT and INSERT policies, which left no
-- way to attach an entry to a batch — the balance is defined by
-- payout_batch_id IS NULL, so without this nothing could ever be paid.
--
-- This is safe because the column-level restriction is enforced by
-- private.commission_entries_guard(), not by the policy: the trigger still
-- refuses any update that changes anything other than payout_batch_id, and
-- refuses re-batching an entry that already has one. The policy only decides
-- *who* may attempt an update; the trigger decides what an update may do.
--
-- Agents get no UPDATE policy at all.
-- ---------------------------------------------------------------------------

create policy "commission_entries_admin_batch_update" on public.commission_entries
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. Sweep support
--
-- The nightly job looks for payments that have cleared but have no earned
-- entry yet, and for payments whose refund has grown since the last sweep.
-- ---------------------------------------------------------------------------

create index if not exists idx_payments_cleared_at
  on public.payments (cleared_at)
  where cleared_at is not null;

create index if not exists idx_payments_refunded
  on public.payments (deal_id)
  where refunded_amount_cents > 0;

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    raise exception 'Permissive policy: %.% evaluates to true', r.tablename, r.policyname;
  end loop;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_commission_entries_earned_per_payment'
  ) then
    raise exception 'the earned-per-payment uniqueness guard is missing';
  end if;
end
$$;
