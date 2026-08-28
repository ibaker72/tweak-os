-- ============================================================================
-- 00016_revenue_core.sql
--
-- Splits `leads` (which was doing prospect + contact + customer at once) into
-- a revenue model that survives a client signing twice, upgrading, churning,
-- and coming back:
--
--   leads     — a prospect. Unchanged.
--   accounts  — a business once it is a customer. Many per lead is possible;
--               a lead is where the account came from, not what it is.
--   deals     — one signed contract. Many per account.
--   payments  — money actually received, per deal.
--   commission_entries — append-only ledger. The only source of truth for
--               what an agent is owed.
--
-- Money is bigint cents everywhere. Rates are integer basis points
-- (3000 = 30%). All timestamps are timestamptz.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. agent_profiles — commission and payout attributes
--
-- Internal agents and external referral partners are the same object with a
-- different partner_type. One commission engine, not two: two engines
-- eventually disagree and then the reconciliation is manual.
--
-- is_active and created_at already exist from 00006 and are not redefined.
-- ---------------------------------------------------------------------------

alter table public.agent_profiles
  add column if not exists default_commission_rate_bps integer not null default 3000,
  add column if not exists payout_method text,
  add column if not exists payout_handle text,
  add column if not exists partner_type text not null default 'internal_agent',
  add column if not exists started_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_profiles_partner_type_ck'
  ) then
    alter table public.agent_profiles
      add constraint agent_profiles_partner_type_ck
      check (partner_type in ('internal_agent', 'referral_partner'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agent_profiles_payout_method_ck'
  ) then
    alter table public.agent_profiles
      add constraint agent_profiles_payout_method_ck
      check (payout_method is null or payout_method in ('stripe', 'paypal'));
  end if;

  -- A negative or >100% default rate is always a data-entry error.
  if not exists (
    select 1 from pg_constraint where conname = 'agent_profiles_rate_ck'
  ) then
    alter table public.agent_profiles
      add constraint agent_profiles_rate_ck
      check (default_commission_rate_bps between 0 and 10000);
  end if;
end
$$;

-- Seed the existing sales agents at 30%. The column default already covers
-- rows created from here on; this catches anything inserted before it existed.
update public.agent_profiles
set default_commission_rate_bps = 3000
where default_commission_rate_bps is null;

-- ---------------------------------------------------------------------------
-- 2. accounts — a business once it is a customer
-- ---------------------------------------------------------------------------

create table if not exists public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  -- Nullable: an account can exist without a sourcing lead (direct inbound,
  -- migrated client). ON DELETE SET NULL so deleting a stale lead never
  -- cascades into revenue history.
  lead_id               uuid references public.leads(id) on delete set null,
  company_name          text not null,
  primary_contact_name  text,
  primary_contact_email text,
  primary_contact_phone text,
  website               text,
  status                text not null default 'active'
                          check (status in ('active', 'paused', 'churned')),
  owner_agent_id        uuid references public.agent_profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. deals — one row per signed contract
--
-- commission_rate_bps is snapshotted at signing. If an agent's default rate
-- changes later, historical deals must not silently reprice — that is the
-- whole reason the rate lives here and not only on agent_profiles.
-- ---------------------------------------------------------------------------

create table if not exists public.deals (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  name                     text not null,
  deal_type                text not null
                             check (deal_type in ('rapid_build', 'custom_engineering', 'growth_retainer')),
  commission_model         text not null
                             check (commission_model in ('one_time', 'recurring')),
  contract_value_cents     bigint not null default 0 check (contract_value_cents >= 0),
  mrr_cents                bigint not null default 0 check (mrr_cents >= 0),
  status                   text not null default 'draft'
                             check (status in ('draft', 'sent', 'signed', 'delivering', 'complete', 'lost', 'refunded')),
  closed_by_agent_id       uuid references public.agent_profiles(id) on delete set null,
  signed_at                timestamptz,
  commission_rate_bps      integer check (commission_rate_bps between 0 and 10000),
  -- NULL means uncapped: commission accrues for the life of the retainer.
  recurring_cap_months     integer check (recurring_cap_months is null or recurring_cap_months > 0),
  recurring_months_accrued integer not null default 0 check (recurring_months_accrued >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- The rate snapshot is not optional once a deal is real. Draft/sent/lost
  -- deals are still being shaped and may not have one yet.
  constraint deals_rate_snapshot_ck check (
    status in ('draft', 'sent', 'lost') or commission_rate_bps is not null
  ),

  -- A signed deal has a signing date.
  constraint deals_signed_at_ck check (
    status in ('draft', 'sent', 'lost') or signed_at is not null
  ),

  -- The amount that matches the commission model has to be populated once the
  -- deal leaves draft, or commission accrues against zero.
  constraint deals_model_amount_ck check (
    status = 'draft'
    or (commission_model = 'one_time' and contract_value_cents > 0)
    or (commission_model = 'recurring' and mrr_cents > 0)
  ),

  -- Only recurring deals accrue month by month.
  constraint deals_recurring_fields_ck check (
    commission_model = 'recurring'
    or (recurring_cap_months is null and recurring_months_accrued = 0)
  )
);

-- ---------------------------------------------------------------------------
-- 4. deal_milestones — for projects billed in stages
-- ---------------------------------------------------------------------------

create table if not exists public.deal_milestones (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals(id) on delete cascade,
  label        text not null,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  due_date     date,
  invoiced_at  timestamptz,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. payments — money actually received
--
-- received_at and cleared_at are deliberately separate. Commission accrues off
-- cleared_at, and the window between the two is the refund and chargeback
-- buffer. Collapsing them into one column destroys that protection: a payment
-- that arrives and reverses would have already paid out commission.
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id                     uuid primary key default gen_random_uuid(),
  deal_id                uuid not null references public.deals(id) on delete cascade,
  milestone_id           uuid references public.deal_milestones(id) on delete set null,
  amount_cents           bigint not null check (amount_cents >= 0),
  currency               text not null default 'usd',
  received_at            timestamptz not null default now(),
  -- NULL until the money is actually settled and out of the refund window.
  cleared_at             timestamptz,
  -- For retainers: which service month this payment covers.
  period_start           date,
  period_end             date,
  method                 text,
  -- Stripe payment intent, invoice number, or whatever the source system uses.
  external_ref           text,
  refunded_at            timestamptz,
  refunded_amount_cents  bigint not null default 0 check (refunded_amount_cents >= 0),
  created_at             timestamptz not null default now(),

  constraint payments_refund_not_over_ck check (refunded_amount_cents <= amount_cents),
  constraint payments_refund_pair_ck check (
    (refunded_at is null and refunded_amount_cents = 0)
    or (refunded_at is not null and refunded_amount_cents > 0)
  ),
  constraint payments_cleared_after_received_ck check (
    cleared_at is null or cleared_at >= received_at
  ),
  constraint payments_period_order_ck check (
    period_start is null or period_end is null or period_end >= period_start
  )
);

-- ---------------------------------------------------------------------------
-- 6. payout_batches — a run of payments to one agent
-- ---------------------------------------------------------------------------

create table if not exists public.payout_batches (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agent_profiles(id) on delete restrict,
  period_start date not null,
  period_end   date not null,
  -- Signed: a batch can net negative if clawbacks exceed earnings.
  total_cents  bigint not null default 0,
  method       text check (method is null or method in ('stripe', 'paypal')),
  status       text not null default 'pending'
                 check (status in ('pending', 'processing', 'paid', 'failed')),
  paid_at      timestamptz,
  external_ref text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint payout_batches_period_order_ck check (period_end >= period_start)
);

-- ---------------------------------------------------------------------------
-- 7. commission_entries — the append-only ledger
--
-- There is deliberately no balance column anywhere. An agent's unpaid balance
-- is SUM(amount_cents) WHERE payout_batch_id IS NULL. A stored balance that
-- has been corrected has no history behind it, and that is an argument you
-- cannot win with someone whose income it is.
--
-- amount_cents is signed: clawbacks are negative rows, never edits.
-- ---------------------------------------------------------------------------

create table if not exists public.commission_entries (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agent_profiles(id) on delete restrict,
  deal_id          uuid not null references public.deals(id) on delete restrict,
  payment_id       uuid references public.payments(id) on delete restrict,
  entry_type       text not null
                     check (entry_type in ('earned', 'clawback', 'adjustment', 'bonus')),
  -- Signed. Clawbacks are negative.
  amount_cents     bigint not null,
  rate_bps_applied integer check (rate_bps_applied between 0 and 10000),
  -- What the rate was applied to, so any row can be re-derived by hand.
  basis_cents      bigint,
  memo             text,
  payout_batch_id  uuid references public.payout_batches(id) on delete restrict,
  payable_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  created_by       uuid references public.agent_profiles(id) on delete set null,

  -- Sign discipline: the entry_type and the sign of the amount must agree, so
  -- a mistyped clawback cannot quietly increase what is owed.
  constraint commission_entries_sign_ck check (
    (entry_type = 'earned'   and amount_cents >= 0)
    or (entry_type = 'clawback' and amount_cents <= 0)
    or (entry_type = 'bonus'    and amount_cents >= 0)
    or entry_type = 'adjustment'
  )
);

-- ---------------------------------------------------------------------------
-- 8. Ledger immutability
--
-- DELETE is always refused. UPDATE is refused except for the single permitted
-- transition: attaching an unbatched entry to a payout batch (NULL -> value,
-- once). Without that one exception nothing could ever be paid out, because
-- the unpaid balance is defined by payout_batch_id IS NULL.
--
-- The comparison uses to_jsonb(row) minus the batch column, so a column added
-- to this table later is protected automatically rather than silently becoming
-- editable.
-- ---------------------------------------------------------------------------

create or replace function private.commission_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'commission_entries is append-only: DELETE is not permitted (entry %). Write a reversing entry instead.',
      old.id
      using errcode = 'restrict_violation';
  end if;

  if old.payout_batch_id is not null then
    raise exception
      'commission_entry % is already in payout batch %; batched entries are frozen',
      old.id, old.payout_batch_id
      using errcode = 'restrict_violation';
  end if;

  if new.payout_batch_id is null then
    raise exception
      'commission_entries is append-only: the only permitted update is assigning payout_batch_id (entry %)',
      old.id
      using errcode = 'restrict_violation';
  end if;

  if (to_jsonb(new) - 'payout_batch_id') is distinct from (to_jsonb(old) - 'payout_batch_id') then
    raise exception
      'commission_entries is append-only: only payout_batch_id may be set (entry %). Write a reversing entry instead.',
      old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end
$$;

drop trigger if exists commission_entries_no_update on public.commission_entries;
create trigger commission_entries_no_update
  before update on public.commission_entries
  for each row execute function private.commission_entries_guard();

drop trigger if exists commission_entries_no_delete on public.commission_entries;
create trigger commission_entries_no_delete
  before delete on public.commission_entries
  for each row execute function private.commission_entries_guard();

-- ---------------------------------------------------------------------------
-- 9. attributions — who gets credit for a lead, and until when
--
-- Manual intros get a row like everything else, so the tie-break has one
-- input set. Resolution rule (applied in the app, Phase 3): the earliest
-- non-expired first_touch_at wins, unless an admin sets is_override with a
-- written reason.
-- ---------------------------------------------------------------------------

create table if not exists public.attributions (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agent_profiles(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  source          text not null
                    check (source in ('referral_link', 'manual_intro', 'self_sourced', 'inbound_assigned')),
  first_touch_at  timestamptz not null default now(),
  -- Defaults to first_touch_at + 90 days via trigger below; an admin can set
  -- a different window explicitly.
  expires_at      timestamptz,
  resolved_at     timestamptz,
  is_override     boolean not null default false,
  override_reason text,
  override_by     uuid references public.agent_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),

  -- An override without a written reason is exactly the thing that turns into
  -- an argument later, so the reason is required at the database level.
  constraint attributions_override_reason_ck check (
    not is_override
    or (override_reason is not null and length(btrim(override_reason)) > 0)
  ),
  constraint attributions_override_by_ck check (not is_override or override_by is not null),
  constraint attributions_expiry_order_ck check (expires_at is null or expires_at >= first_touch_at)
);

-- The 90-day window is the default, not a hard rule — set expires_at
-- explicitly to override it.
create or replace function private.attributions_default_expiry()
returns trigger
language plpgsql
-- Not SECURITY DEFINER: it only reads columns off NEW and needs no elevated
-- rights. search_path is still pinned so it cannot be redirected.
set search_path = ''
as $$
begin
  if new.expires_at is null then
    new.expires_at := new.first_touch_at + interval '90 days';
  end if;
  return new;
end
$$;

drop trigger if exists attributions_set_expiry on public.attributions;
create trigger attributions_set_expiry
  before insert on public.attributions
  for each row execute function private.attributions_default_expiry();

-- ---------------------------------------------------------------------------
-- 10. updated_at triggers, matching the existing convention
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'deals', 'deal_milestones', 'payout_batches']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.update_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Indexes for the queries this schema actually serves
-- ---------------------------------------------------------------------------

-- "What is this agent owed right now?" — the hottest query in the system.
create index if not exists idx_commission_entries_unpaid
  on public.commission_entries (agent_id, payout_batch_id)
  where payout_batch_id is null;

create index if not exists idx_deals_closed_by_status
  on public.deals (closed_by_agent_id, status);

create index if not exists idx_payments_deal_cleared
  on public.payments (deal_id, cleared_at);

create index if not exists idx_attributions_lead_expires
  on public.attributions (lead_id, expires_at);

-- Supporting indexes for the foreign keys the RLS predicates traverse.
create index if not exists idx_accounts_owner_agent on public.accounts (owner_agent_id);
create index if not exists idx_accounts_lead on public.accounts (lead_id);
create index if not exists idx_deals_account on public.deals (account_id);
create index if not exists idx_deal_milestones_deal on public.deal_milestones (deal_id);
create index if not exists idx_payments_milestone on public.payments (milestone_id);
create index if not exists idx_commission_entries_deal on public.commission_entries (deal_id);
create index if not exists idx_commission_entries_payment on public.commission_entries (payment_id);
create index if not exists idx_commission_entries_batch on public.commission_entries (payout_batch_id);
create index if not exists idx_payout_batches_agent_status on public.payout_batches (agent_id, status);
create index if not exists idx_attributions_agent on public.attributions (agent_id);

-- ---------------------------------------------------------------------------
-- 12. RLS
--
-- Same model as 00015. Agents read their own money and nothing else; every
-- write to a revenue table is an admin action. An agent who could insert their
-- own commission_entries could pay themselves.
-- ---------------------------------------------------------------------------

alter table public.accounts            enable row level security;
alter table public.deals               enable row level security;
alter table public.deal_milestones     enable row level security;
alter table public.payments            enable row level security;
alter table public.payout_batches      enable row level security;
alter table public.commission_entries  enable row level security;
alter table public.attributions        enable row level security;

-- Does the calling agent own the account behind this deal, or did they close
-- it? SECURITY DEFINER so child policies resolve without re-evaluating the
-- deals policies.
create or replace function private.can_read_deal(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.deals d
    where d.id = p_deal_id
      and d.closed_by_agent_id = (select private.current_agent_id())
  )
$$;

revoke all on function private.can_read_deal(uuid) from public;
grant execute on function private.can_read_deal(uuid) to authenticated, service_role;

-- accounts
create policy "accounts_admin_all" on public.accounts
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "accounts_agent_select" on public.accounts
  for select to authenticated
  using (owner_agent_id = (select private.current_agent_id()));

-- deals — agents read the deals they closed.
create policy "deals_admin_all" on public.deals
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "deals_agent_select" on public.deals
  for select to authenticated
  using (closed_by_agent_id = (select private.current_agent_id()));

-- deal_milestones and payments — scoped through the parent deal.
create policy "deal_milestones_admin_all" on public.deal_milestones
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "deal_milestones_agent_select" on public.deal_milestones
  for select to authenticated
  using ((select private.can_read_deal(deal_id)));

create policy "payments_admin_all" on public.payments
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "payments_agent_select" on public.payments
  for select to authenticated
  using ((select private.can_read_deal(deal_id)));

-- commission_entries — agents read only their own; only admins insert.
--
-- No UPDATE or DELETE policy exists for anyone, admins included. The trigger
-- above is the real guard; the absence of policies means even an admin has to
-- go through the service role to batch entries, which is where Phase 3's
-- payout job will run.
create policy "commission_entries_admin_select" on public.commission_entries
  for select to authenticated
  using ((select private.is_admin()));

create policy "commission_entries_admin_insert" on public.commission_entries
  for insert to authenticated
  with check ((select private.is_admin()));

create policy "commission_entries_agent_select" on public.commission_entries
  for select to authenticated
  using (agent_id = (select private.current_agent_id()));

-- payout_batches — agents read their own; only admins write.
create policy "payout_batches_admin_all" on public.payout_batches
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "payout_batches_agent_select" on public.payout_batches
  for select to authenticated
  using (agent_id = (select private.current_agent_id()));

-- attributions — agents see credit claims naming them; only admins write,
-- because writing one is how credit (and therefore money) is assigned.
create policy "attributions_admin_all" on public.attributions
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "attributions_agent_select" on public.attributions
  for select to authenticated
  using (agent_id = (select private.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 13. Verification — same guarantees 00015 established, re-checked after the
-- new tables land.
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

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'Table public.% does not have RLS enabled', r.relname;
  end loop;

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      )
  loop
    raise exception 'Table public.% has RLS enabled but no policies', r.relname;
  end loop;
end
$$;
