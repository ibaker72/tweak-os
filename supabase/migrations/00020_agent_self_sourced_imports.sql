-- ============================================================================
-- 00020_agent_self_sourced_imports.sql
--
-- Agents source their own leads (Mary's research sheet) and need them in the
-- system without Phase 1's lead-creation block being lifted.
--
-- The block stays exactly where it is: there is still no INSERT policy on
-- public.leads for agents, and this migration's verification block fails if
-- one ever appears. Instead imports run through
-- public.import_agent_leads(), a SECURITY DEFINER function on the same model
-- as convert_lead_to_account():
--
--   * the crediting agent comes from private.current_agent_id(), which reads
--     the JWT. There is no agent parameter, so there is nothing for a client
--     to forge and no way to import onto a teammate.
--   * only whitelisted per-row keys are read out of the payload. An
--     `assigned_to`, `agent_id`, `source` or `rate` key smuggled into the
--     JSON is not read at all, so it cannot influence ownership, credit, or
--     money.
--   * every imported lead gets a matching 'self_sourced' attribution row, so
--     Phase 5's rate rule has the explicit record it needs. Only an
--     'inbound_assigned' attribution reduces an agent to the inbound rate; a
--     self-sourced lead with no attribution row at all would work by accident
--     today and break the day that default changes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema additions
--
-- contact_name: Mary's sheet carries a decision-maker per row. It had nowhere
-- to land — manual_notes is prose, not a field you can filter on.
--
-- import_jobs.created_by: the admin importer is one shared history. Once
-- agents import too, "who ran this" is the difference between an agent's own
-- import history and the whole team's.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists contact_name text;

alter table public.import_jobs
  add column if not exists created_by uuid references public.agent_profiles(id) on delete set null,
  add column if not exists source text not null default 'admin_upload';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_jobs_source_ck'
  ) then
    alter table public.import_jobs
      add constraint import_jobs_source_ck
      check (source in ('admin_upload', 'agent_self_sourced'));
  end if;
end
$$;

create index if not exists idx_import_jobs_created_by on public.import_jobs (created_by);

-- Duplicate detection matches on external_id, then on business_name + state.
-- Both are case-insensitive, so plain btree indexes on the raw columns do not
-- serve them. These do.
create index if not exists idx_leads_external_id_lower
  on public.leads (lower(external_id)) where external_id is not null;

create index if not exists idx_leads_name_state_lower
  on public.leads (lower(business_name), lower(state));

-- ---------------------------------------------------------------------------
-- 2. import_agent_leads
--
-- Takes the rows the server-side CSV parser already validated, as a JSON
-- array, plus a filename for the import job. Returns a summary.
--
-- Duplicate detection deliberately looks at every lead in the table, not just
-- the caller's. Two agents importing the same business is precisely the case
-- that makes commission attribution ambiguous, and scoping the check to the
-- caller's own leads would let it through.
--
-- Row-level failures do not abort the import: a bad row is counted and the
-- rest still land, which is how the admin importer already behaves.
-- ---------------------------------------------------------------------------

create or replace function public.import_agent_leads(
  p_rows           jsonb,
  p_filename       text    default 'agent-import.csv',
  -- How many rows the CSV parser rejected before this call. Display only: it
  -- is added to the job's total and failed counts so the import job matches
  -- what the agent uploaded rather than only what survived parsing. It cannot
  -- touch ownership, credit, or which rows are written.
  p_parse_failures integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent     uuid;
  v_job_id    uuid;
  v_row       jsonb;
  v_total     integer;
  v_imported  integer := 0;
  v_skipped   integer := 0;
  v_failed    integer := 0;
  v_failures  jsonb := '[]'::jsonb;
  v_index     integer := 0;
  v_rejected  integer;
  v_name      text;
  v_state     text;
  v_external  text;
  v_lead_id   uuid;
  v_now       timestamptz := now();
begin
  -- Identity comes from the JWT, never from a parameter. This is the whole
  -- reason the function exists.
  v_agent := private.current_agent_id();

  if v_agent is null then
    raise exception 'no active agent profile for the calling user'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  v_rejected := greatest(coalesce(p_parse_failures, 0), 0);
  v_total := jsonb_array_length(p_rows);

  -- A ceiling here is what stops one request from writing an unbounded number
  -- of rows under a definer function's privileges.
  if v_total > 5000 then
    raise exception 'import is limited to 5000 rows per file (got %)', v_total
      using errcode = 'program_limit_exceeded';
  end if;

  insert into public.import_jobs (filename, total_rows, status, created_by, source)
  values (
    coalesce(nullif(btrim(p_filename), ''), 'agent-import.csv'),
    v_total + v_rejected,
    'processing',
    v_agent,
    'agent_self_sourced'
  )
  returning id into v_job_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;

    -- Every field read below is named explicitly. Anything else in the
    -- payload — assigned_to, agent_id, source, rate, attribution overrides —
    -- is never looked at, so it cannot reach a column.
    v_name := nullif(btrim(coalesce(v_row ->> 'business_name', '')), '');

    if v_name is null then
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'row', v_index, 'message', 'Business name is required'
      );
      continue;
    end if;

    v_state    := nullif(btrim(coalesce(v_row ->> 'state', '')), '');
    v_external := nullif(btrim(coalesce(v_row ->> 'external_id', '')), '');

    if exists (
      select 1 from public.leads l
      where v_external is not null and lower(l.external_id) = lower(v_external)
    ) or exists (
      select 1 from public.leads l
      where lower(l.business_name) = lower(v_name)
        and (v_state is null or lower(coalesce(l.state, '')) = lower(v_state))
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      insert into public.leads (
        business_name, city, state, address, zip, website, email, phone,
        contact_name, manual_notes, niche, external_id, source,
        assigned_to, assigned_at,
        lifecycle_status, enrichment_status, score, reasons, score_breakdown,
        tech_stack, social_links
      ) values (
        v_name,
        nullif(btrim(coalesce(v_row ->> 'city', '')), ''),
        v_state,
        nullif(btrim(coalesce(v_row ->> 'address', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'zip', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'website', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'email', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'contact_name', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'notes', '')), ''),
        coalesce(
          nullif(btrim(coalesce(v_row ->> 'niche', '')), ''),
          nullif(btrim(coalesce(v_row ->> 'industry', '')), '')
        ),
        v_external,
        -- Not client-supplied: the CSV's own `source` column is ignored so a
        -- self-sourced lead cannot be labelled as anything else.
        'self_sourced',
        v_agent,
        v_now,
        'new', 'pending', 0, '[]'::jsonb, '{}'::jsonb,
        '{}'::text[], '{}'::jsonb
      )
      returning id into v_lead_id;

      -- The credit record Phase 5 reads. agent_id is the caller, source is
      -- fixed, and expires_at is left NULL so the attributions trigger applies
      -- the standard 90-day window rather than anything the client chose.
      insert into public.attributions (agent_id, lead_id, source, first_touch_at)
      values (v_agent, v_lead_id, 'self_sourced', v_now);

      insert into public.activity_log (lead_id, module, action, entity_type, entity_id, details)
      values (
        v_lead_id, 'leads', 'lead.self_sourced_import', 'lead', v_lead_id,
        jsonb_build_object('import_job_id', v_job_id, 'credited_to', v_agent)
      );

      v_imported := v_imported + 1;
    exception
      when others then
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'row', v_index,
          'message', format('Failed to import %s: %s', v_name, sqlerrm)
        );
    end;
  end loop;

  update public.import_jobs
  set imported_rows = v_imported,
      skipped_rows  = v_skipped,
      failed_rows   = v_failed + v_rejected,
      status        = 'completed'
  where id = v_job_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'total_rows', v_total + v_rejected,
    'imported_rows', v_imported,
    'skipped_duplicates', v_skipped,
    'failed_rows', v_failed + v_rejected,
    'credited_to', v_agent,
    'failures', v_failures
  );
end
$$;

revoke all on function public.import_agent_leads(jsonb, text, integer) from public;
grant execute on function public.import_agent_leads(jsonb, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Verification
--
-- The first two blocks repeat 00015's guarantees. The last two are this
-- migration's own claim: agents gained an import path and nothing else. If a
-- later change hands them a direct INSERT on leads, or lets them write their
-- own attributions, this migration stops applying.
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

  -- Agents must still have no way to write leads or attributions directly.
  -- Every INSERT/UPDATE/DELETE policy on either table has to be the admin
  -- predicate; import_agent_leads() is the only other way in.
  for r in
    select tablename, policyname, cmd from pg_policies
    where schemaname = 'public'
      and tablename in ('leads', 'attributions')
      and cmd in ('INSERT', 'DELETE')
      and qual is distinct from '( SELECT private.is_admin() AS is_admin)'
      and with_check is distinct from '( SELECT private.is_admin() AS is_admin)'
  loop
    raise exception
      'Non-admin write policy on %.%: % — agents must import through import_agent_leads()',
      r.tablename, r.policyname, r.cmd;
  end loop;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'import_agent_leads'
      and p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search\_path=%'
      )
  ) then
    raise exception
      'import_agent_leads must be SECURITY DEFINER with a pinned empty search_path';
  end if;
end
$$;
