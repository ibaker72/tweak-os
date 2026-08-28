-- ============================================================================
-- 00015_rls_role_scoping.sql
--
-- Replaces every permissive `using (true)` policy with role- and
-- ownership-aware policies, ahead of the sales team getting logins.
--
-- Before this migration RLS was enabled on all 23 public tables, but every
-- one carried a blanket "Authenticated users can manage X" policy. Any
-- authenticated user could read, reassign, or delete every lead, read every
-- proposal's pricing, and read site_configs.client_secret in plaintext.
--
-- Model:
--   admin  — full access to everything
--   agent  — select/update only the leads assigned to them; no insert,
--            no delete; cannot reassign a lead away from themselves
--   child records (outreach_sequences, activity_log, proposals, sms_messages)
--          — scoped through the parent lead's assignment
--   config//reference tables — agents read, admins write
--   orphaned tables (growth_*, site_configs, automation_logs, lead_audits)
--          — admin only; their application code was removed in Phase 0
--
-- Deactivating an agent (is_active = false) revokes all access: the helper
-- functions below stop resolving them, so every ownership predicate goes
-- false rather than null-matching anything.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper functions
--
-- These live in a `private` schema and are SECURITY DEFINER so they can read
-- agent_profiles without tripping that table's own RLS. Querying
-- agent_profiles directly inside an agent_profiles policy recurses infinitely;
-- routing every lookup through a definer function is what prevents that.
--
-- STABLE + `search_path = ''` per Supabase guidance: STABLE lets the planner
-- cache the result within a statement, and the empty search_path forces every
-- reference to be schema-qualified so the function cannot be hijacked by a
-- caller-controlled search_path.
-- ---------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- The agent_profiles.id for the calling user, or NULL when the caller has no
-- profile or has been deactivated.
--
-- Note this returns agent_profiles.id, NOT auth.uid(). They are different
-- columns: agent_profiles.id is the table's own PK and is what
-- leads.assigned_to references; user_id is the auth.users link.
create or replace function private.current_agent_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ap.id
  from public.agent_profiles ap
  where ap.user_id = (select auth.uid())
    and ap.is_active
  limit 1
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_profiles ap
    where ap.user_id = (select auth.uid())
      and ap.is_active
      and ap.role = 'admin'
  )
$$;

-- True when the calling agent is assigned the given lead. SECURITY DEFINER so
-- child-table policies resolve ownership without also evaluating the leads
-- policies, which keeps the predicate cheap and its meaning unambiguous.
create or replace function private.owns_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.assigned_to = (select private.current_agent_id())
  )
$$;

revoke all on function private.current_agent_id() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.owns_lead(uuid) from public;

grant execute on function private.current_agent_id() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.owns_lead(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Schema additions
-- ---------------------------------------------------------------------------

-- proposals had no owner column at all, and lead_id is nullable — a proposal
-- built without linking a lead had nothing to scope on. Existing rows get NULL
-- and are therefore admin-only until an admin claims them.
alter table public.proposals
  add column if not exists created_by uuid references public.agent_profiles(id) on delete set null;

create index if not exists idx_proposals_created_by on public.proposals (created_by);

-- Supporting indexes for the ownership predicates below. Without these every
-- agent-scoped read is a sequential scan.
create index if not exists idx_leads_assigned_to on public.leads (assigned_to);
create index if not exists idx_outreach_sequences_lead_id on public.outreach_sequences (lead_id);
create index if not exists idx_activity_log_entity on public.activity_log (entity_type, entity_id);
create index if not exists idx_activity_log_lead_id on public.activity_log (lead_id);
create index if not exists idx_sms_messages_lead_id on public.sms_messages (lead_id);
create index if not exists idx_proposals_lead_id on public.proposals (lead_id);

-- Agents need to see teammate names to read "assigned to" labels and populate
-- assignment dropdowns, but must not see teammate emails, roles, or user_ids.
-- This view is intentionally NOT security_invoker: it runs as its owner so it
-- can project three safe columns out of a table agents cannot otherwise read.
-- That is the entire point — it is the name-only teammate directory.
drop view if exists public.agent_directory;
create view public.agent_directory
with (security_invoker = false) as
  select ap.id, ap.display_name, ap.is_active
  from public.agent_profiles ap;

revoke all on public.agent_directory from public, anon;
grant select on public.agent_directory to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Drop every existing policy on public tables
--
-- Done by introspection rather than by name so that no permissive policy can
-- survive this migration through a typo or a policy added out of band.
-- ---------------------------------------------------------------------------

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. leads — the core ownership boundary
--
-- Agents get select + update on their own assigned leads only. No insert (lead
-- creation runs through discovery/import, which are admin workflows) and no
-- delete. The `with check` on the update policy is what stops an agent
-- reassigning a lead: after the update the row must still be assigned to them,
-- so setting assigned_to to a teammate or to NULL is rejected.
-- ---------------------------------------------------------------------------

create policy "leads_admin_all" on public.leads
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "leads_agent_select" on public.leads
  for select to authenticated
  using (assigned_to = (select private.current_agent_id()));

create policy "leads_agent_update" on public.leads
  for update to authenticated
  using (assigned_to = (select private.current_agent_id()))
  with check (assigned_to = (select private.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 5. outreach_sequences — scoped through the parent lead
-- ---------------------------------------------------------------------------

create policy "outreach_sequences_admin_all" on public.outreach_sequences
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "outreach_sequences_agent_select" on public.outreach_sequences
  for select to authenticated
  using ((select private.owns_lead(lead_id)));

create policy "outreach_sequences_agent_insert" on public.outreach_sequences
  for insert to authenticated
  with check ((select private.owns_lead(lead_id)));

create policy "outreach_sequences_agent_update" on public.outreach_sequences
  for update to authenticated
  using ((select private.owns_lead(lead_id)))
  with check ((select private.owns_lead(lead_id)));

-- ---------------------------------------------------------------------------
-- 6. activity_log — scoped through the parent lead, append-only for agents
--
-- The lead link is recorded two different ways. activity_log.lead_id is the
-- original column from 00003, but src/lib/shared/activity-logger.ts has never
-- written it — it writes entity_type = 'lead' with entity_id. Scoping on
-- lead_id alone would therefore hide every row from agents, so both paths are
-- checked. Rows tied to no lead at all (module-level events) stay admin-only.
--
-- No update policy for anyone: an audit trail that can be rewritten is not an
-- audit trail. Admins can delete for retention cleanup.
-- ---------------------------------------------------------------------------

create policy "activity_log_admin_select" on public.activity_log
  for select to authenticated
  using ((select private.is_admin()));

create policy "activity_log_admin_insert" on public.activity_log
  for insert to authenticated
  with check ((select private.is_admin()));

create policy "activity_log_admin_delete" on public.activity_log
  for delete to authenticated
  using ((select private.is_admin()));

create policy "activity_log_agent_select" on public.activity_log
  for select to authenticated
  using (
    (lead_id is not null and (select private.owns_lead(lead_id)))
    or (
      entity_type = 'lead'
      and entity_id is not null
      and (select private.owns_lead(entity_id))
    )
  );

create policy "activity_log_agent_insert" on public.activity_log
  for insert to authenticated
  with check (
    (lead_id is not null and (select private.owns_lead(lead_id)))
    or (
      entity_type = 'lead'
      and entity_id is not null
      and (select private.owns_lead(entity_id))
    )
  );

-- ---------------------------------------------------------------------------
-- 7. agent_profiles — own row only; all writes are admin
--
-- Every predicate here goes through private.is_admin() / current_agent_id()
-- rather than selecting from agent_profiles, which would recurse.
-- Teammate names come from public.agent_directory instead.
-- ---------------------------------------------------------------------------

create policy "agent_profiles_admin_all" on public.agent_profiles
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "agent_profiles_self_select" on public.agent_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 8. proposals and sms_messages — scoped through lead or creator
--
-- Not named in the Phase 1 brief, but both hold client-sensitive data
-- (pricing, message bodies) and both were world-readable to any authenticated
-- user. Scoped on the same model as the other child records.
-- ---------------------------------------------------------------------------

create policy "proposals_admin_all" on public.proposals
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "proposals_agent_select" on public.proposals
  for select to authenticated
  using (
    created_by = (select private.current_agent_id())
    or (lead_id is not null and (select private.owns_lead(lead_id)))
  );

create policy "proposals_agent_insert" on public.proposals
  for insert to authenticated
  with check (created_by = (select private.current_agent_id()));

create policy "proposals_agent_update" on public.proposals
  for update to authenticated
  using (
    created_by = (select private.current_agent_id())
    or (lead_id is not null and (select private.owns_lead(lead_id)))
  )
  with check (
    created_by = (select private.current_agent_id())
    or (lead_id is not null and (select private.owns_lead(lead_id)))
  );

create policy "sms_messages_admin_all" on public.sms_messages
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "sms_messages_agent_select" on public.sms_messages
  for select to authenticated
  using (lead_id is not null and (select private.owns_lead(lead_id)));

create policy "sms_messages_agent_insert" on public.sms_messages
  for insert to authenticated
  with check (lead_id is not null and (select private.owns_lead(lead_id)));

create policy "sms_messages_agent_update" on public.sms_messages
  for update to authenticated
  using (lead_id is not null and (select private.owns_lead(lead_id)))
  with check (lead_id is not null and (select private.owns_lead(lead_id)));

-- ---------------------------------------------------------------------------
-- 9. Config and reference tables — agents read, admins write
--
-- `current_agent_id() is not null` means "an active profile exists", which
-- covers admins too since admins also hold an agent_profiles row.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'import_jobs',
    'enrichment_jobs',
    'saved_searches',
    'smart_lists',
    'outreach_templates',
    'discovery_jobs',
    'discovery_results',
    'google_places_cache',
    'api_usage'
  ]
  loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using ((select private.current_agent_id()) is not null)
    $f$, t || '_agent_select', t);

    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check ((select private.is_admin()))
    $f$, t || '_admin_insert', t);

    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using ((select private.is_admin()))
        with check ((select private.is_admin()))
    $f$, t || '_admin_update', t);

    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using ((select private.is_admin()))
    $f$, t || '_admin_delete', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Orphaned tables — admin only
--
-- Phase 0 removed the application code for all of these. The tables are kept
-- (dropping them is a separate decision) but nothing should reach them, and
-- site_configs in particular stores client_secret in plaintext, which was
-- readable by every authenticated user under the old policy.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'growth_opportunities',
    'growth_briefs',
    'growth_drafts',
    'growth_performance',
    'growth_calendar',
    'lead_audits',
    'site_configs',
    'automation_logs'
  ]
  loop
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using ((select private.is_admin()))
        with check ((select private.is_admin()))
    $f$, t || '_admin_all', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Verification — fail the migration if anything is still wide open
-- ---------------------------------------------------------------------------

do $$
declare
  open_policy record;
  missing_rls record;
begin
  for open_policy in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    raise exception
      'Permissive policy survived migration: %.% still evaluates to true',
      open_policy.tablename, open_policy.policyname;
  end loop;

  for missing_rls in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    raise exception 'Table public.% does not have RLS enabled', missing_rls.relname;
  end loop;
end
$$;
