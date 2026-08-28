-- ============================================================================
-- 00018_agent_tools.sql
--
-- Backing for the agent-facing surfaces (/my/queue, /my/pipeline,
-- /my/commissions, and Convert to Account):
--
--   1. Per-agent overrides of the shared outreach templates.
--   2. outreach_sequences becomes the send log: it now records which template
--      was used and which activity_log row the send produced.
--   3. A controlled lead -> account/deal conversion.
--
-- Agents still get no direct INSERT on accounts or deals. Conversion runs
-- through a SECURITY DEFINER function that snapshots the commission rate
-- server-side, so an agent can never write a deal that pays them a rate they
-- chose.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-agent template overrides
--
-- The shared outreach_templates stay admin-owned. An agent who wants their own
-- wording gets a row here rather than editing the team's copy out from under
-- everyone else.
-- ---------------------------------------------------------------------------

create table if not exists public.agent_template_overrides (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agent_profiles(id) on delete cascade,
  template_id uuid not null references public.outreach_templates(id) on delete cascade,
  subject     text,
  body        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One override per agent per template; editing replaces it.
  constraint agent_template_overrides_unique unique (agent_id, template_id),
  -- An override that overrides nothing is a row nobody meant to create.
  constraint agent_template_overrides_not_empty check (
    subject is not null or body is not null
  )
);

create index if not exists idx_agent_template_overrides_agent
  on public.agent_template_overrides (agent_id);

drop trigger if exists agent_template_overrides_updated_at on public.agent_template_overrides;
create trigger agent_template_overrides_updated_at
  before update on public.agent_template_overrides
  for each row execute function public.update_updated_at();

alter table public.agent_template_overrides enable row level security;

create policy "agent_template_overrides_admin_all" on public.agent_template_overrides
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- An agent manages their own overrides and cannot see or write a teammate's.
create policy "agent_template_overrides_own_select" on public.agent_template_overrides
  for select to authenticated
  using (agent_id = (select private.current_agent_id()));

create policy "agent_template_overrides_own_insert" on public.agent_template_overrides
  for insert to authenticated
  with check (agent_id = (select private.current_agent_id()));

create policy "agent_template_overrides_own_update" on public.agent_template_overrides
  for update to authenticated
  using (agent_id = (select private.current_agent_id()))
  with check (agent_id = (select private.current_agent_id()));

create policy "agent_template_overrides_own_delete" on public.agent_template_overrides
  for delete to authenticated
  using (agent_id = (select private.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 2. outreach_sequences as the send log
--
-- It already records channel, subject, body, status and sent_at per lead.
-- Adding the template it came from and the activity_log row it produced turns
-- it into the send log without a second table that could disagree with it.
-- ---------------------------------------------------------------------------

alter table public.outreach_sequences
  add column if not exists template_id uuid references public.outreach_templates(id) on delete set null,
  add column if not exists activity_log_id uuid references public.activity_log(id) on delete set null;

create index if not exists idx_outreach_sequences_template
  on public.outreach_sequences (template_id);

create index if not exists idx_outreach_sequences_agent_sent
  on public.outreach_sequences (agent_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- 3. Convert a lead into an account and a draft deal
--
-- SECURITY DEFINER because agents have SELECT-only on accounts and deals and
-- must keep it that way: direct INSERT would let an agent write their own
-- commission_rate_bps. Here the rate is read from the caller's own
-- agent_profiles row inside the function, so it is never client-supplied.
--
-- The deal is created as 'draft'. An admin reviews the contract value and
-- moves it to 'signed'; until then it shows on the agent's pipeline as
-- unsigned and contributes no expected commission.
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
  v_lead       record;
  v_account_id uuid;
  v_deal_id    uuid;
  v_owner      uuid;
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

  -- An agent may only convert a lead assigned to them. Admins convert anything.
  if not v_is_admin and v_lead.assigned_to is distinct from v_agent then
    raise exception 'lead % is not assigned to you', p_lead_id
      using errcode = 'insufficient_privilege';
  end if;

  -- The account and the resulting commission belong to whoever owns the lead,
  -- not to whoever clicked the button — otherwise an admin converting on an
  -- agent's behalf would quietly take the credit.
  v_owner := coalesce(v_lead.assigned_to, v_agent);

  -- Rate snapshot, read server-side. This is the single reason this function
  -- is SECURITY DEFINER rather than a plain insert from the application.
  select ap.default_commission_rate_bps
    into v_rate
  from public.agent_profiles ap
  where ap.id = v_owner;

  if v_rate is null then
    raise exception 'no commission rate on agent profile %', v_owner
      using errcode = 'no_data_found';
  end if;

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
    case when p_commission_model = 'recurring' then p_recurring_cap_months end
  )
  returning id into v_deal_id;

  -- Resolve the winning attribution, applying the documented tie-break: an
  -- admin override wins outright, otherwise the earliest non-expired first
  -- touch. Losing rows stay unresolved as the record of who else was in play.
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
      'converted_by', v_agent,
      'credited_to', v_owner
    )
  );

  return jsonb_build_object(
    'account_id', v_account_id,
    'deal_id', v_deal_id,
    'commission_rate_bps', v_rate,
    'credited_to', v_owner
  );
end
$$;

revoke all on function public.convert_lead_to_account(
  uuid, text, text, text, text, bigint, bigint, integer, text, text, text
) from public;

grant execute on function public.convert_lead_to_account(
  uuid, text, text, text, text, bigint, bigint, integer, text, text, text
) to authenticated, service_role;

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

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'Table public.% does not have RLS enabled', r.relname;
  end loop;

  -- Agents must not gain direct write access to the revenue tables; the
  -- conversion function is the only way in.
  for r in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename in ('accounts', 'deals')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and qual is distinct from '( SELECT private.is_admin() AS is_admin)'
      and with_check is distinct from '( SELECT private.is_admin() AS is_admin)'
  loop
    raise exception
      'Non-admin write policy on %.%: % — agents must convert through convert_lead_to_account()',
      r.tablename, r.policyname, r.cmd;
  end loop;
end
$$;
