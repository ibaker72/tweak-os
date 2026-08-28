-- ============================================================================
-- 00019_admin_and_payments.sql
--
-- Implements the five Phase 5 decisions:
--
--   1. Retainer cap defaults to 6 months.
--   2. Split credit is not built, but the seam is left open: the ledger's
--      uniqueness key becomes (payment_id, agent_id).
--   3. Self-sourced work pays a higher rate than inbound you handed over.
--   4. employment_classification is a field with three states, not a decision
--      baked into the schema.
--   5. Stripe is the payment source, and received_at stays distinct from
--      cleared_at.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Split-credit seam
--
-- Nothing here supports two agents on one deal yet. But the old index —
-- unique on (payment_id) where entry_type = 'earned' — makes that impossible
-- to add without a migration that rewrites the ledger's uniqueness guarantee
-- while real money is in it. Widening the key to (payment_id, agent_id) is a
-- no-op while there is one agent per deal, and removes the painful half of the
-- retrofit.
--
-- The guarantee is unchanged in practice: one earned entry per payment per
-- agent, so a re-run still cannot double-pay anyone.
-- ---------------------------------------------------------------------------

drop index if exists public.uq_commission_entries_earned_per_payment;

create unique index if not exists uq_commission_entries_earned_per_payment_agent
  on public.commission_entries (payment_id, agent_id)
  where entry_type = 'earned' and payment_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Rate by attribution source
--
-- default_commission_rate_bps keeps its meaning: the rate for work the agent
-- brought in themselves. inbound_commission_rate_bps applies when the lead was
-- handed to them.
--
-- The default is deliberately equal to the self-sourced rate rather than
-- lower. Nothing in the app creates attributions rows yet and agents cannot
-- create leads, so "no attribution" is the common case — and a missing data
-- row must never quietly cut someone's pay. Only an explicit
-- 'inbound_assigned' attribution reduces the rate.
-- ---------------------------------------------------------------------------

alter table public.agent_profiles
  add column if not exists inbound_commission_rate_bps integer not null default 2000;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_profiles_inbound_rate_ck'
  ) then
    alter table public.agent_profiles
      add constraint agent_profiles_inbound_rate_ck
      check (inbound_commission_rate_bps between 0 and 10000);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Employment classification
--
-- Three states, defaulting to unset, so the year-end export can adapt rather
-- than the schema having to guess.
--
-- Note what is NOT stored here: a full TIN. A SSN or EIN sitting in an
-- application database is a liability with no upside — the full number belongs
-- in whatever files the 1099. Only the last four are kept, which is enough to
-- match a record without being worth stealing.
-- ---------------------------------------------------------------------------

alter table public.agent_profiles
  add column if not exists employment_classification text not null default 'unset',
  add column if not exists legal_name text,
  add column if not exists tax_address text,
  add column if not exists tax_id_last4 text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_profiles_classification_ck'
  ) then
    alter table public.agent_profiles
      add constraint agent_profiles_classification_ck
      check (employment_classification in ('contractor_1099', 'employee_w2', 'unset'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agent_profiles_tax_id_last4_ck'
  ) then
    alter table public.agent_profiles
      add constraint agent_profiles_tax_id_last4_ck
      check (tax_id_last4 is null or tax_id_last4 ~ '^[0-9]{4}$');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Payments from Stripe
--
-- received_at and cleared_at stay separate, which is the whole point of the
-- chosen option: charge.succeeded means the money arrived, not that it is
-- safe. cleared_at is set later, after the settlement delay, and that gap is
-- the chargeback buffer.
--
-- The Stripe ids are unique so a replayed webhook cannot create a second
-- payment for the same charge.
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists source text not null default 'manual',
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_payment_intent_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_source_ck'
  ) then
    alter table public.payments
      add constraint payments_source_ck check (source in ('manual', 'stripe'));
  end if;
end
$$;

create unique index if not exists uq_payments_stripe_charge
  on public.payments (stripe_charge_id)
  where stripe_charge_id is not null;

create index if not exists idx_payments_uncleared
  on public.payments (received_at)
  where cleared_at is null;

-- ---------------------------------------------------------------------------
-- 5. Settlement sweep
--
-- Moves payments from received to cleared once the settlement window has
-- passed and nothing has been refunded. Commission accrues off cleared_at, so
-- this is the gate that decides when money becomes earnable.
--
-- A refunded payment is deliberately left uncleared: if it came back before it
-- settled, no commission should ever have accrued on it.
-- ---------------------------------------------------------------------------

create or replace function public.clear_settled_payments(p_settlement_days integer default 7)
returns table (payment_id uuid, deal_id uuid, amount_cents bigint)
language sql
security definer
set search_path = ''
as $$
  update public.payments p
  set cleared_at = p.received_at + make_interval(days => p_settlement_days)
  where p.cleared_at is null
    and p.refunded_at is null
    and p.received_at + make_interval(days => p_settlement_days) <= now()
  returning p.id, p.deal_id, p.amount_cents
$$;

revoke all on function public.clear_settled_payments(integer) from public;
grant execute on function public.clear_settled_payments(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Conversion, with the rate chosen by attribution source
--
-- Replaces the 00018 version. Two changes:
--
--   The commission rate now depends on how the lead was sourced. Only an
--   explicit 'inbound_assigned' attribution applies the lower inbound rate;
--   anything else, including no attribution at all, keeps the self-sourced
--   rate. Failing safe toward the agent matters here — the alternative is a
--   missing row silently costing someone ten points of commission.
--
--   Recurring deals default to a 6-month cap when none is given.
--
-- The rate is still read server-side and is still not a parameter.
-- ---------------------------------------------------------------------------

create or replace function public.convert_lead_to_account(
  p_lead_id                uuid,
  p_company_name           text,
  p_deal_name              text,
  p_deal_type              text,
  p_commission_model       text,
  p_contract_value_cents   bigint  default 0,
  p_mrr_cents              bigint  default 0,
  p_recurring_cap_months   integer default null,
  p_primary_contact_name   text    default null,
  p_primary_contact_email  text    default null,
  p_primary_contact_phone  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent      uuid;
  v_is_admin   boolean;
  v_rate       integer;
  v_rate_basis text;
  v_source     text;
  v_lead       record;
  v_account_id uuid;
  v_deal_id    uuid;
  v_owner      uuid;
  v_cap        integer;
begin
  v_agent := private.current_agent_id();
  v_is_admin := private.is_admin();

  if v_agent is null then
    raise exception 'no active agent profile for the calling user'
      using errcode = 'insufficient_privilege';
  end if;

  select id, assigned_to, business_name, website, phone
    into v_lead
  from public.leads
  where id = p_lead_id;

  if not found then
    raise exception 'lead % not found', p_lead_id using errcode = 'no_data_found';
  end if;

  if not v_is_admin and v_lead.assigned_to is distinct from v_agent then
    raise exception 'lead % is not assigned to you', p_lead_id
      using errcode = 'insufficient_privilege';
  end if;

  v_owner := coalesce(v_lead.assigned_to, v_agent);

  -- Which rate applies depends on the winning attribution's source, using the
  -- same tie-break as resolution below.
  select a.source
    into v_source
  from public.attributions a
  where a.lead_id = p_lead_id
    and (a.is_override or a.expires_at > now())
  order by a.is_override desc, a.first_touch_at asc
  limit 1;

  if v_source = 'inbound_assigned' then
    select ap.inbound_commission_rate_bps, 'inbound_assigned'
      into v_rate, v_rate_basis
    from public.agent_profiles ap where ap.id = v_owner;
  else
    -- Self-sourced, referral, manual intro, or no attribution on file.
    select ap.default_commission_rate_bps, coalesce(v_source, 'no_attribution')
      into v_rate, v_rate_basis
    from public.agent_profiles ap where ap.id = v_owner;
  end if;

  if v_rate is null then
    raise exception 'no commission rate on agent profile %', v_owner
      using errcode = 'no_data_found';
  end if;

  -- Retainers default to a six-month cap.
  v_cap := case
    when p_commission_model <> 'recurring' then null
    else coalesce(p_recurring_cap_months, 6)
  end;

  insert into public.accounts (
    lead_id, company_name, primary_contact_name, primary_contact_email,
    primary_contact_phone, website, status, owner_agent_id
  ) values (
    p_lead_id,
    coalesce(nullif(btrim(p_company_name), ''), v_lead.business_name),
    p_primary_contact_name,
    p_primary_contact_email,
    coalesce(p_primary_contact_phone, v_lead.phone),
    v_lead.website,
    'active',
    v_owner
  )
  returning id into v_account_id;

  insert into public.deals (
    account_id, name, deal_type, commission_model, contract_value_cents,
    mrr_cents, status, closed_by_agent_id, commission_rate_bps,
    recurring_cap_months
  ) values (
    v_account_id,
    coalesce(nullif(btrim(p_deal_name), ''), 'New deal'),
    p_deal_type,
    p_commission_model,
    coalesce(p_contract_value_cents, 0),
    coalesce(p_mrr_cents, 0),
    'draft',
    v_owner,
    v_rate,
    v_cap
  )
  returning id into v_deal_id;

  update public.attributions a
  set resolved_at = now()
  where a.id = (
    select w.id
    from public.attributions w
    where w.lead_id = p_lead_id
      and w.resolved_at is null
      and (w.is_override or w.expires_at > now())
    order by w.is_override desc, w.first_touch_at asc
    limit 1
  );

  update public.leads
  set lifecycle_status = 'won'
  where id = p_lead_id;

  insert into public.activity_log (lead_id, module, action, entity_type, entity_id, details)
  values (
    p_lead_id, 'leads', 'lead.converted', 'lead', p_lead_id,
    jsonb_build_object(
      'account_id', v_account_id,
      'deal_id', v_deal_id,
      'commission_rate_bps', v_rate,
      'rate_basis', v_rate_basis,
      'recurring_cap_months', v_cap,
      'converted_by', v_agent,
      'credited_to', v_owner
    )
  );

  return jsonb_build_object(
    'account_id', v_account_id,
    'deal_id', v_deal_id,
    'commission_rate_bps', v_rate,
    'rate_basis', v_rate_basis,
    'recurring_cap_months', v_cap,
    'credited_to', v_owner
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Reassign a departing agent's book
--
-- Moves open leads and account ownership to another agent. Deliberately does
-- NOT touch deals.closed_by_agent_id or any commission_entries: the person who
-- closed a deal closed it, and commission already earned stays earned. A
-- reassignment that quietly moved someone's ledger would be indistinguishable
-- from theft.
-- ---------------------------------------------------------------------------

create or replace function public.reassign_agent_book(
  p_from_agent uuid,
  p_to_agent   uuid,
  p_deactivate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leads    integer;
  v_accounts integer;
begin
  if not private.is_admin() then
    raise exception 'only an admin may reassign a book'
      using errcode = 'insufficient_privilege';
  end if;

  if p_from_agent = p_to_agent then
    raise exception 'cannot reassign an agent to themselves'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.agent_profiles where id = p_to_agent and is_active) then
    raise exception 'destination agent % is missing or inactive', p_to_agent
      using errcode = 'invalid_parameter_value';
  end if;

  with moved as (
    update public.leads
    set assigned_to = p_to_agent, assigned_at = now()
    where assigned_to = p_from_agent
      and lifecycle_status not in ('won', 'lost', 'not_a_fit', 'archived', 'deleted')
    returning 1
  )
  select count(*) into v_leads from moved;

  with moved as (
    update public.accounts
    set owner_agent_id = p_to_agent
    where owner_agent_id = p_from_agent and status = 'active'
    returning 1
  )
  select count(*) into v_accounts from moved;

  if p_deactivate then
    update public.agent_profiles set is_active = false where id = p_from_agent;
  end if;

  insert into public.activity_log (module, action, entity_type, entity_id, details)
  values (
    'platform', 'agent.book_reassigned', 'agent_profile', p_from_agent,
    jsonb_build_object(
      'from_agent', p_from_agent,
      'to_agent', p_to_agent,
      'leads_moved', v_leads,
      'accounts_moved', v_accounts,
      'deactivated', p_deactivate,
      'note', 'closed deals and commission entries deliberately untouched'
    )
  );

  return jsonb_build_object(
    'leads_moved', v_leads,
    'accounts_moved', v_accounts,
    'deactivated', p_deactivate
  );
end
$$;

revoke all on function public.reassign_agent_book(uuid, uuid, boolean) from public;
grant execute on function public.reassign_agent_book(uuid, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Verification
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    raise exception 'Permissive policy: %.% evaluates to true', r.tablename, r.policyname;
  end loop;

  for r in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'Table public.% does not have RLS enabled', r.relname;
  end loop;

  -- The split-credit seam must be the widened key, not the old one.
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'uq_commission_entries_earned_per_payment'
  ) then
    raise exception 'the narrow (payment_id) ledger index still exists';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_commission_entries_earned_per_payment_agent'
  ) then
    raise exception 'the (payment_id, agent_id) ledger index is missing';
  end if;
end
$$;
