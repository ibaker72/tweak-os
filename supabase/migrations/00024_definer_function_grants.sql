-- ============================================================================
-- 00024_definer_function_grants.sql
--
-- Closes an unauthenticated hole in public.clear_settled_payments().
--
-- What went wrong
-- ---------------
-- 00019 created that function SECURITY DEFINER and wrote what looks like the
-- correct lock:
--
--     revoke all on function public.clear_settled_payments(integer) from public;
--     grant execute on function public.clear_settled_payments(integer) to service_role;
--
-- On stock Postgres that is enough. On Supabase it is not. Supabase ships
--
--     alter default privileges in schema public
--       grant all on functions to postgres, anon, authenticated, service_role;
--
-- so every new function in `public` is created with EXECUTE already granted to
-- `anon` and `authenticated` *as named roles*. `revoke ... from public` removes
-- the PUBLIC pseudo-role grant and leaves those two untouched. Verified against
-- production: has_function_privilege('anon', 'clear_settled_payments', 'EXECUTE')
-- returned true, and PostgREST exposes it at /rest/v1/rpc/clear_settled_payments
-- to anyone holding the anon key — which ships in the browser bundle and is
-- public by design.
--
-- Why it matters more than the other nine
-- ---------------------------------------
-- Every other SECURITY DEFINER function in `public` re-checks the caller
-- itself (private.is_admin() or private.current_agent_id()), so reaching them
-- as anon achieves nothing. clear_settled_payments() has no such check — the
-- grant was its only guard.
--
-- What it does is set payments.cleared_at, and cleared_at is the single input
-- that turns received money into accrued commission. `clear_settled_payments(0)`
-- sets cleared_at = received_at on every outstanding payment, which satisfies
-- payments_cleared_after_received_ck and passes the WHERE clause for every row
-- already received. That collapses the chargeback/refund buffer the whole
-- revenue design rests on: the next accrual sweep pays commission on money that
-- has not settled and can still reverse.
--
-- The fix is both halves, because either alone is a single point of failure:
--   1. an internal caller check, so the function is safe whatever the grants say
--   2. correct grants, so it is not reachable in the first place
-- plus a verification block that fails the migration if anon can still execute
-- any SECURITY DEFINER function in public.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Give clear_settled_payments the caller check every other definer has
--
-- Rewritten as plpgsql purely to have somewhere to put the guard; the UPDATE is
-- unchanged.
--
-- The check reads the request's JWT role claim, NOT current_user: inside a
-- SECURITY DEFINER function current_user is the owner, so it would never see
-- who actually called. The claim is what PostgREST sets per request and what
-- auth.uid()/auth.role() already read.
--
-- A request carrying no JWT at all leaves the claim NULL and is allowed
-- through: that is the nightly cron's connection, a migration, and the test
-- harness — all of which already hold database credentials, so there is
-- nothing left to authorise. Browser-facing callers always carry a claim, and
-- those are the ones this refuses.
--
-- drop first: the return type is unchanged but CREATE OR REPLACE cannot switch
-- a function's language cleanly across every PG version, and dropping also
-- discards the inherited ACL, which is the second half of this fix.
-- ---------------------------------------------------------------------------

drop function if exists public.clear_settled_payments(integer);

create function public.clear_settled_payments(p_settlement_days integer default 7)
returns table (payment_id uuid, deal_id uuid, amount_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jwt_role text;
begin
  v_jwt_role := nullif(
    pg_catalog.current_setting('request.jwt.claims', true), ''
  )::jsonb ->> 'role';

  if v_jwt_role in ('anon', 'authenticated') and not private.is_admin() then
    raise exception 'only an admin or the settlement job may clear payments'
      using errcode = 'insufficient_privilege';
  end if;

  -- A negative window would date cleared_at before received_at and trip
  -- payments_cleared_after_received_ck. Refusing it here names the problem
  -- instead of surfacing a constraint violation.
  if p_settlement_days is null or p_settlement_days < 0 then
    raise exception 'settlement window must be a non-negative number of days (got %)',
      p_settlement_days
      using errcode = 'invalid_parameter_value';
  end if;

  return query
    update public.payments p
    set cleared_at = p.received_at + make_interval(days => p_settlement_days)
    where p.cleared_at is null
      and p.refunded_at is null
      and p.received_at + make_interval(days => p_settlement_days) <= now()
    returning p.id, p.deal_id, p.amount_cents;
end
$$;

revoke all on function public.clear_settled_payments(integer) from public, anon, authenticated;
grant execute on function public.clear_settled_payments(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Take anon off every other SECURITY DEFINER function in public
--
-- These all guard themselves, so this is defence in depth rather than a fix.
-- An unauthenticated caller has no business reaching an RPC that exists to act
-- as a signed-in agent, even one that will refuse it.
--
-- `authenticated` keeps its grant here: these are the agent-facing RPCs, and
-- each decides for itself what the caller may do.
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname <> 'clear_settled_payments'
  loop
    execute format('revoke all on function %s from anon', fn.sig);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Stop the default privilege from re-granting anon on the next function
--
-- Without this, the next SECURITY DEFINER function added to `public` inherits
-- the same anon EXECUTE and the same mistake is one migration away.
-- ---------------------------------------------------------------------------

alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    raise exception 'anon can still execute SECURITY DEFINER function %', fn.sig;
  end loop;

  if has_function_privilege('authenticated', 'public.clear_settled_payments(integer)', 'EXECUTE') then
    raise exception 'authenticated can still execute clear_settled_payments';
  end if;

  if not has_function_privilege('service_role', 'public.clear_settled_payments(integer)', 'EXECUTE') then
    raise exception 'the settlement job lost its grant on clear_settled_payments';
  end if;
end
$$;
