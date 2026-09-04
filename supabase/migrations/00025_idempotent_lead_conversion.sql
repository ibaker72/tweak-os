-- ============================================================================
-- 00025_idempotent_lead_conversion.sql
--
-- Makes lead -> account conversion a one-time transition.
--
-- What went wrong
-- ---------------
-- convert_lead_to_account() read the lead, checked authorisation, and then
-- inserted an account and a deal unconditionally. It never asked whether the
-- lead had already been converted, never locked anything, and there was no
-- unique constraint on accounts.lead_id — only the plain btree
-- idx_accounts_lead. So this was not even a check-then-insert race, which at
-- least has a check to lose: it was an unconditional double insert with
-- nothing to serialise on.
--
-- Reproduced on two concurrent Postgres sessions against the pre-fix function:
-- both calls succeeded and the lead ended up with 2 accounts, 2 deals, and 2
-- 'lead.converted' rows in the activity trail. A double-click, a browser
-- retry after a timeout, or two open tabs all produce the same thing.
--
-- The business rule this encodes
-- ------------------------------
-- 00016 recorded the opposite intent — "many per lead is possible; a lead is
-- where the account came from, not what it is". That is deliberately
-- overridden here, on the product owner's explicit instruction:
--
--     ONE LEAD -> ONE INITIAL CUSTOMER ACCOUNT -> ONE INITIAL DRAFT DEAL
--
-- Several deals against that account remain perfectly valid, and always did;
-- what is now forbidden is a second account sourced from the same lead. An
-- account with no sourcing lead (direct inbound, a migrated client) is
-- untouched — the unique index is partial, so NULL lead_id stays unconstrained
-- and many such accounts can coexist.
--
-- The guarantee is three layers deep, because each covers what the others
-- cannot:
--
--   1. A partial UNIQUE index on accounts.lead_id. The actual guarantee. It
--      holds against every code path, including ones written later and direct
--      SQL, and it cannot be forgotten.
--   2. SELECT ... FOR UPDATE on the lead row inside the function. The index
--      alone would make the losing caller fail; the lock makes it *wait*, then
--      re-read and return the winner's account. Deterministic success rather
--      than a handled error.
--   3. An exception handler on unique_violation. Reachable only if an account
--      is created for the lead without taking the lock. It re-reads and
--      returns the canonical conversion rather than surfacing a 500 for what
--      is a harmless duplicate attempt.
--
-- accounts.lead_id was chosen as the source of truth because it already exists
-- and already means exactly this. A leads.converted_account_id column or a
-- separate lead_conversions table would each add a second place for the same
-- fact to live, and two places eventually disagree.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The constraint
--
-- Partial rather than plain, purely to state the intent: NULL lead_id is not
-- "an account we failed to link", it is an account with no sourcing lead, and
-- there may be any number of those. (A plain unique index would behave the
-- same, since Postgres never treats two NULLs as equal.)
--
-- Safe to create unconditionally: production holds 0 accounts, and no
-- deployment of this system has ever produced a duplicate to resolve first.
-- ---------------------------------------------------------------------------

create unique index if not exists accounts_one_per_lead_uk
  on public.accounts (lead_id)
  where lead_id is not null;

comment on index public.accounts_one_per_lead_uk is
  'One account per sourcing lead. Conversion is a one-time transition; accounts with no lead are unconstrained.';

-- ---------------------------------------------------------------------------
-- 2. The function
--
-- Same signature, same parameters, same authorisation rules, same rate
-- resolution, same credit rule (the lead's assignee is credited, never
-- whoever clicked Convert). The additions are the lock, the already-converted
-- check, the recovery path, and idempotence on the three tail writes.
--
-- Two behaviours worth naming because they were latent bugs the duplicate was
-- hiding:
--
--   The attribution resolve now runs only when nothing is resolved for this
--   lead yet. Previously a second conversion would resolve a *second*
--   attribution, because its subquery filtered on resolved_at is null and the
--   winner was already stamped.
--
--   The activity_log insert now runs only when no 'lead.converted' row exists
--   for the lead, so one economic conversion produces exactly one event.
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
  v_owner_seen uuid;
begin
  v_agent := private.current_agent_id();
  v_is_admin := private.is_admin();

  if v_agent is null then
    raise exception 'no active agent profile for the calling user'
      using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE: everything below decides whether this lead already has an
  -- account, so two callers must not evaluate that question at once. The lock
  -- is per-lead and transaction-scoped, so converting different leads never
  -- contends, and it is released on commit either way.
  select id, assigned_to, business_name, website, phone
    into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'lead % not found', p_lead_id using errcode = 'no_data_found';
  end if;

  if not v_is_admin and v_lead.assigned_to is distinct from v_agent then
    raise exception 'lead % is not assigned to you', p_lead_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Authorisation is checked BEFORE the conversion state is disclosed: an
  -- agent must not learn that a teammate's lead is converted by asking.
  v_owner := coalesce(v_lead.assigned_to, v_agent);

  -- ---- Already converted? -------------------------------------------------
  --
  -- Read under the lock, so this cannot be stale by the time it is acted on.
  select a.id, a.owner_agent_id
    into v_account_id, v_owner_seen
  from public.accounts a
  where a.lead_id = p_lead_id
  order by a.created_at asc, a.id asc
  limit 1;

  if v_account_id is not null then
    -- Oldest deal on the account is the one conversion created. Later deals
    -- are ordinary business and must not make this look unconverted.
    select d.id, d.commission_rate_bps, d.recurring_cap_months
      into v_deal_id, v_rate, v_cap
    from public.deals d
    where d.account_id = v_account_id
    order by d.created_at asc, d.id asc
    limit 1;

    if v_deal_id is not null then
      -- The whole conversion is already on record. Return the canonical rows
      -- rather than raising: a duplicate attempt is harmless, and the caller
      -- wants to know where the account is.
      return jsonb_build_object(
        'status', 'already_converted',
        'account_id', v_account_id,
        'deal_id', v_deal_id,
        'commission_rate_bps', v_rate,
        'rate_basis', (
          select l.details ->> 'rate_basis'
          from public.activity_log l
          where l.entity_type = 'lead'
            and l.entity_id = p_lead_id
            and l.action = 'lead.converted'
          order by l.created_at asc
          limit 1
        ),
        'recurring_cap_months', v_cap,
        'credited_to', coalesce(v_owner_seen, v_owner)
      );
    end if;

    -- An account with no deal is a conversion that did not finish. It should
    -- not be reachable — the whole function commits or rolls back as one
    -- statement — but an account inserted by hand would land here, and the
    -- right repair is to add the missing deal, not a second account.
    v_owner := coalesce(v_owner_seen, v_owner);
  end if;

  -- ---- Rate resolution ----------------------------------------------------
  --
  -- Unchanged from 00019. Which rate applies depends on the winning
  -- attribution's source, using the same tie-break as the resolve below.
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

  -- ---- The account --------------------------------------------------------
  if v_account_id is null then
    begin
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
    exception when unique_violation then
      -- Backstop. Only reachable if an account was created for this lead
      -- without taking the lock above, which no application path does. Return
      -- the canonical conversion rather than a 500 for a duplicate attempt.
      select a.id, a.owner_agent_id into v_account_id, v_owner_seen
      from public.accounts a
      where a.lead_id = p_lead_id
      order by a.created_at asc, a.id asc
      limit 1;

      select d.id, d.commission_rate_bps, d.recurring_cap_months
        into v_deal_id, v_rate, v_cap
      from public.deals d
      where d.account_id = v_account_id
      order by d.created_at asc, d.id asc
      limit 1;

      return jsonb_build_object(
        'status', 'already_converted',
        'account_id', v_account_id,
        'deal_id', v_deal_id,
        'commission_rate_bps', v_rate,
        'rate_basis', null,
        'recurring_cap_months', v_cap,
        'credited_to', coalesce(v_owner_seen, v_owner)
      );
    end;
  end if;

  -- ---- The initial deal ---------------------------------------------------
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

  -- ---- Attribution ---------------------------------------------------------
  --
  -- Guarded on nothing being resolved yet. Without the guard a second
  -- conversion resolved a *second* attribution, because the subquery filters
  -- on resolved_at is null and the real winner was already stamped. Credit is
  -- not re-derived here and never moves to whoever clicked Convert.
  if not exists (
    select 1 from public.attributions a
    where a.lead_id = p_lead_id and a.resolved_at is not null
  ) then
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
  end if;

  update public.leads
  set lifecycle_status = 'won'
  where id = p_lead_id;

  -- ---- The conversion event ------------------------------------------------
  --
  -- One economic conversion, one row. Repeated attempts return early above and
  -- never reach this, but the guard also covers the recovery path.
  if not exists (
    select 1 from public.activity_log l
    where l.entity_type = 'lead'
      and l.entity_id = p_lead_id
      and l.action = 'lead.converted'
  ) then
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
  end if;

  return jsonb_build_object(
    'status', 'converted',
    'account_id', v_account_id,
    'deal_id', v_deal_id,
    'commission_rate_bps', v_rate,
    'rate_basis', v_rate_basis,
    'recurring_cap_months', v_cap,
    'credited_to', v_owner
  );
end
$$;

-- CREATE OR REPLACE preserves the existing ACL, but 00024 revoked anon and
-- this must not quietly hand it back.
revoke all on function public.convert_lead_to_account(
  uuid, text, text, text, text, bigint, bigint, integer, text, text, text
) from public, anon;
grant execute on function public.convert_lead_to_account(
  uuid, text, text, text, text, bigint, bigint, integer, text, text, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'accounts_one_per_lead_uk'
  ) then
    raise exception 'the one-account-per-lead guarantee is missing';
  end if;

  if exists (
    select 1 from public.accounts
    where lead_id is not null
    group by lead_id having count(*) > 1
  ) then
    raise exception 'duplicate accounts per lead survived the migration';
  end if;

  if has_function_privilege('anon', 'public.convert_lead_to_account(uuid, text, text, text, text, bigint, bigint, integer, text, text, text)', 'EXECUTE') then
    raise exception 'anon regained execute on convert_lead_to_account';
  end if;
end
$$;
