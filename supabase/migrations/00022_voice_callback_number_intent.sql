-- ============================================================================
-- 00022_voice_callback_number_intent.sql
--
-- Repairs one specific failure in the click-to-call callback number, found in
-- production on 2026-09-02:
--
--   POST /rest/v1/rpc/set_my_voice_phone returned 200,
--   agent_profiles.updated_at moved to the exact moment of that request,
--   and agent_profiles.voice_phone was still NULL afterwards.
--
-- The schema was never the problem — 00021 is fully applied, voice_phone
-- exists, and every surface reads the same column. What happened is that
-- set_my_voice_phone() treated "the field was empty" as "clear my number",
-- so a Save pressed on an empty box silently wiped the setting and reported
-- success. There is no way for a caller to distinguish "I meant to erase it"
-- from "I did not type anything", and the destructive reading was the default.
--
-- This migration makes erasing the number something the caller has to ask for:
--
--   * set_my_voice_phone(p_phone, p_clear) refuses a blank p_phone unless
--     p_clear is true, and reports `blank_without_clear` instead of writing.
--   * every success is verified. The function reads the column back after the
--     UPDATE and returns the stored value, so `ok: true` means the database
--     actually holds that number — not that an UPDATE statement was issued.
--     A write that matches no row now reports `not_saved` rather than success.
--   * the returned value is what the row holds, so the UI cannot display a
--     number the database does not have.
--
-- Nothing else changes. The canonical column is still
-- public.agent_profiles.voice_phone, the RLS model is untouched (agents still
-- have no UPDATE policy on agent_profiles; this definer function remains their
-- only path to that one column), and no call is recorded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Replace the one-argument function
--
-- Dropped rather than left alongside the new signature: `set_my_voice_phone(
-- p_phone => $1)` would be ambiguous between a one-argument function and a
-- two-argument one whose second argument has a default, and PostgREST calls it
-- by name. Dropping first is what keeps the existing call sites resolving.
--
-- Deploy ordering is safe in both directions. Application code that predates
-- this migration sends only p_phone, resolves to the new function through the
-- default, and gets the non-destructive reading of a blank field — a refusal
-- rather than a silent erase. Code that postdates it and runs against a
-- database that has not been migrated yet gets a "function not found" error
-- from PostgREST, which the route surfaces as a failure rather than as a
-- success. Neither order loses a saved number.
-- ---------------------------------------------------------------------------

drop function if exists public.set_my_voice_phone(text);

create or replace function public.set_my_voice_phone(
  p_phone text,
  p_clear boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent  uuid;
  v_norm   text;
  v_stored text;
  v_rows   integer;
begin
  v_agent := private.current_agent_id();
  if v_agent is null then
    raise exception 'no active agent profile for the calling user'
      using errcode = 'insufficient_privilege';
  end if;

  -- Blank input. Erasing a saved number is a real thing to want, but it has to
  -- be asked for: without p_clear this is an empty form field, not a decision.
  if p_phone is null or btrim(p_phone) = '' then
    if not coalesce(p_clear, false) then
      select ap.voice_phone into v_stored
      from public.agent_profiles ap
      where ap.id = v_agent;

      return jsonb_build_object(
        'ok', false,
        'reason', 'blank_without_clear',
        'voice_phone', v_stored
      );
    end if;

    update public.agent_profiles set voice_phone = null where id = v_agent;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('ok', false, 'reason', 'not_saved');
    end if;

    -- Read back rather than assume. If anything between here and the column
    -- disagreed with the write, this is where it shows up.
    select ap.voice_phone into v_stored
    from public.agent_profiles ap
    where ap.id = v_agent;

    if v_stored is not null then
      return jsonb_build_object('ok', false, 'reason', 'not_saved', 'voice_phone', v_stored);
    end if;

    return jsonb_build_object('ok', true, 'cleared', true, 'voice_phone', null);
  end if;

  v_norm := private.normalize_phone(p_phone);
  if v_norm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  -- The column's CHECK is narrower than normalize_phone(): a pasted string can
  -- normalise to something starting +0, which the constraint refuses. Catching
  -- it here turns a raw constraint violation into a reason code.
  if v_norm !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  update public.agent_profiles set voice_phone = v_norm where id = v_agent;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_saved');
  end if;

  select ap.voice_phone into v_stored
  from public.agent_profiles ap
  where ap.id = v_agent;

  if v_stored is distinct from v_norm then
    -- The write did not survive. Reporting success here is exactly the bug
    -- this migration exists to remove.
    return jsonb_build_object('ok', false, 'reason', 'not_saved', 'voice_phone', v_stored);
  end if;

  return jsonb_build_object('ok', true, 'cleared', false, 'voice_phone', v_stored);
end
$$;

revoke all on function public.set_my_voice_phone(text, boolean) from public;
grant execute on function public.set_my_voice_phone(text, boolean)
  to authenticated, service_role;

comment on function public.set_my_voice_phone(text, boolean) is
  'Set or clear the calling agent''s own click-to-call callback number. A blank '
  'p_phone is refused unless p_clear is true, and every success is verified by '
  'reading the column back.';

-- ---------------------------------------------------------------------------
-- 2. Verification
--
-- The standing guarantees from 00015 onwards, plus this migration's own: the
-- old one-argument signature is gone, the new one is a definer function with a
-- pinned search_path, and agents still have no direct write to agent_profiles.
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

  -- Exactly one set_my_voice_phone, and it is the two-argument one. Two
  -- overloads would make the PostgREST call ambiguous.
  if (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_my_voice_phone'
  ) <> 1 then
    raise exception 'set_my_voice_phone must exist exactly once';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_my_voice_phone'
      -- pg_get_function_identity_arguments() renders the parameter names as
      -- well as the types, so this is the full signature as declared above.
      and pg_get_function_identity_arguments(p.oid) = 'p_phone text, p_clear boolean'
      and p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search\_path=%'
      )
  ) then
    raise exception
      'set_my_voice_phone(text, boolean) must be SECURITY DEFINER with a pinned search_path';
  end if;

  -- agent_profiles stays admin-write only. The definer function above is the
  -- only path an agent has to their own row, and it touches one column.
  for r in
    select policyname, cmd from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_profiles'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and qual is distinct from '( SELECT private.is_admin() AS is_admin)'
      and with_check is distinct from '( SELECT private.is_admin() AS is_admin)'
  loop
    raise exception
      'Non-admin write policy on agent_profiles: % (%) — agents may only use set_my_voice_phone()',
      r.policyname, r.cmd;
  end loop;

  -- Still no recording in this phase.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'voice_calls'
      and (column_name like '%recording%' or column_name like '%transcript%')
  ) then
    raise exception 'voice_calls must not carry a recording or transcript column in this phase';
  end if;
end
$$;
