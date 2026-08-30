-- ============================================================================
-- 00021_twilio_voice_calls.sql
--
-- Outbound click-to-call. The agent presses one button, Twilio rings the
-- agent's own phone first, and only once the agent picks up does Twilio dial
-- the prospect — with the Tweak & Build number as the caller ID, never the
-- agent's cell.
--
-- The whole security question here is "who decides which number gets dialed".
-- The answer this migration enforces is: the database, from the lead row,
-- never the client. Concretely:
--
--   * agents get SELECT on voice_calls and nothing else. There is no INSERT,
--     UPDATE or DELETE policy for them, so call history cannot be rewritten
--     and a call record cannot be conjured with an arbitrary prospect number.
--   * public.request_voice_call() is the only way in. It takes a lead id and
--     nothing else — no prospect phone, no agent id, no caller id — and reads
--     the prospect's number out of the lead and the agent's callback number
--     out of the caller's own agent_profiles row. There is no parameter to
--     forge, on the same model as import_agent_leads() in 00020.
--   * the number Twilio is told to dial is looked up later by an opaque
--     per-call token, so the callback URL carries an identifier rather than a
--     phone number. A tampered token fails Twilio's request signature anyway.
--   * status updates arrive from Twilio through the service role, which is
--     the server-controlled path. No agent policy grants that write.
--
-- Recording is deliberately absent: no column stores a recording URL, because
-- this phase does not record calls.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. private.normalize_phone
--
-- A SQL mirror of normalizePhoneNumber() in src/lib/sms/config.ts. It exists
-- because the number that actually gets dialed has to be derived inside the
-- definer function — normalising in TypeScript and passing the result in would
-- reintroduce exactly the client-supplied phone number this design removes.
--
-- IMMUTABLE and pinned search_path: same reasoning as the 00015 helpers.
-- ---------------------------------------------------------------------------

create or replace function private.normalize_phone(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text;
begin
  if p_raw is null then
    return null;
  end if;

  -- Strip everything except digits and a leading +, exactly as the TS does.
  v_clean := regexp_replace(btrim(p_raw), '[^0-9+]', '', 'g');
  if v_clean = '' then
    return null;
  end if;

  if left(v_clean, 1) = '+' then
    return case when length(v_clean) >= 8 then v_clean else null end;
  end if;

  -- No country code — assume US/Canada, the only market this dials today.
  if length(v_clean) = 10 then
    return '+1' || v_clean;
  end if;
  if length(v_clean) = 11 and left(v_clean, 1) = '1' then
    return '+' || v_clean;
  end if;

  return null;
end
$$;

revoke all on function private.normalize_phone(text) from public;
grant execute on function private.normalize_phone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. agent_profiles.voice_phone — the number Twilio rings first
--
-- Every agent needs their own. It is the first leg of the bridge, so it is the
-- phone that has to be in the agent's hand, and it is never shown to the
-- prospect: the caller ID on the second leg is TWILIO_FROM_NUMBER.
--
-- Stored E.164 and constrained to it. Agents already read their own
-- agent_profiles row and no teammate's, so this adds no new exposure — and it
-- is deliberately NOT added to public.agent_directory, which stays the
-- name-only teammate view.
-- ---------------------------------------------------------------------------

alter table public.agent_profiles
  add column if not exists voice_phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_profiles_voice_phone_ck'
  ) then
    alter table public.agent_profiles
      add constraint agent_profiles_voice_phone_ck
      check (voice_phone is null or voice_phone ~ '^\+[1-9][0-9]{6,14}$');
  end if;
end
$$;

comment on column public.agent_profiles.voice_phone is
  'E.164 callback number Twilio rings first on a click-to-call. Never shown to the prospect.';

-- ---------------------------------------------------------------------------
-- 3. voice_calls — one row per click-to-call attempt
--
-- Written on request, updated by Twilio's status callback, and never edited by
-- an agent. `disabled` is a first-class status rather than an absence of a
-- row: an attempt made while TWILIO_VOICE_ENABLED is false still happened and
-- still belongs in the history.
--
-- bridge_token is the opaque handle the TwiML callback URL carries. Two v4
-- UUIDs of entropy, unique, and never reused — it is the lookup key for the
-- prospect number, so guessing one must not be worth attempting. gen_random_uuid()
-- lives in pg_catalog, so it resolves even under a pinned empty search_path.
-- ---------------------------------------------------------------------------

create table if not exists public.voice_calls (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  agent_id         uuid not null references public.agent_profiles(id) on delete restrict,
  bridge_token     text not null unique
                     default (replace(gen_random_uuid()::text, '-', '')
                              || replace(gen_random_uuid()::text, '-', '')),
  twilio_call_sid  text,
  -- Snapshots of what was dialed, so history survives a later edit to the
  -- lead's phone or the agent's callback number.
  agent_phone      text,
  prospect_phone   text,
  from_number      text,
  status           text not null default 'requested' check (status in (
    'requested',
    'disabled',
    'initiated',
    'ringing',
    'in-progress',
    'completed',
    'busy',
    'no-answer',
    'failed',
    'canceled'
  )),
  direction        text not null default 'outbound'
                     check (direction in ('outbound', 'inbound')),
  error_message    text,
  started_at       timestamptz,
  answered_at      timestamptz,
  completed_at     timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_voice_calls_lead_id on public.voice_calls (lead_id);
create index if not exists idx_voice_calls_agent_id on public.voice_calls (agent_id);
create index if not exists idx_voice_calls_created_at on public.voice_calls (created_at desc);
create index if not exists idx_voice_calls_status on public.voice_calls (status);
create index if not exists idx_voice_calls_twilio_call_sid
  on public.voice_calls (twilio_call_sid) where twilio_call_sid is not null;

drop trigger if exists voice_calls_updated_at on public.voice_calls;
create trigger voice_calls_updated_at
  before update on public.voice_calls
  for each row execute function update_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS — read-only for agents, admin-all, writes through definer functions
--
-- Agents see a call when they placed it or when they own the lead it is on.
-- The two are usually the same row; they diverge after a book is reassigned,
-- and both halves of that are legitimately theirs to see.
--
-- There is no agent INSERT/UPDATE/DELETE policy, on purpose. That is what
-- makes "an agent cannot rewrite call history" a property of the database
-- rather than a promise made by a route handler.
-- ---------------------------------------------------------------------------

alter table public.voice_calls enable row level security;

drop policy if exists "voice_calls_admin_all" on public.voice_calls;
create policy "voice_calls_admin_all" on public.voice_calls
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "voice_calls_agent_select" on public.voice_calls;
create policy "voice_calls_agent_select" on public.voice_calls
  for select to authenticated
  using (
    agent_id = (select private.current_agent_id())
    or (select private.owns_lead(lead_id))
  );

-- ---------------------------------------------------------------------------
-- 5. request_voice_call — the only way a call record is created
--
-- One parameter: the lead. Everything that decides who gets dialed is read
-- from the database under the caller's own identity.
--
-- Returns a result object rather than raising for the expected refusals
-- (lead not visible, no callback number, no usable lead phone) so the API can
-- turn each into its own message. A caller with no active agent profile is a
-- different thing — that is an authorisation failure and it raises.
--
-- A lead not assigned to the caller is reported exactly like a lead that does
-- not exist. Distinguishing them would confirm the existence of a teammate's
-- lead to someone who cannot read it.
-- ---------------------------------------------------------------------------

create or replace function public.request_voice_call(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent       uuid;
  v_is_admin    boolean;
  v_lead        record;
  v_agent_phone text;
  v_prospect    text;
  v_call_id     uuid;
begin
  v_agent := private.current_agent_id();
  if v_agent is null then
    raise exception 'no active agent profile for the calling user'
      using errcode = 'insufficient_privilege';
  end if;

  v_is_admin := private.is_admin();

  select l.id, l.business_name, l.assigned_to, l.phone, l.phone_1, l.phone_2, l.sms_status
    into v_lead
  from public.leads l
  where l.id = p_lead_id;

  if not found or not (v_is_admin or v_lead.assigned_to = v_agent) then
    return jsonb_build_object('ok', false, 'reason', 'lead_not_found');
  end if;

  -- do_not_contact is not an SMS-only flag; it is the record that this
  -- business asked not to be contacted. Honour it on the voice channel too.
  if v_lead.sms_status = 'do_not_contact' then
    return jsonb_build_object('ok', false, 'reason', 'lead_do_not_contact');
  end if;

  select private.normalize_phone(ap.voice_phone) into v_agent_phone
  from public.agent_profiles ap
  where ap.id = v_agent;

  if v_agent_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'agent_phone_missing');
  end if;

  v_prospect := coalesce(
    private.normalize_phone(v_lead.phone),
    private.normalize_phone(v_lead.phone_1),
    private.normalize_phone(v_lead.phone_2)
  );

  if v_prospect is null then
    return jsonb_build_object('ok', false, 'reason', 'lead_phone_missing');
  end if;

  -- Dialing yourself bridges a call to itself. Twilio would charge for it and
  -- the agent would hear their own hold music.
  if v_prospect = v_agent_phone then
    return jsonb_build_object('ok', false, 'reason', 'same_number');
  end if;

  insert into public.voice_calls (
    lead_id, agent_id, agent_phone, prospect_phone, status, direction
  ) values (
    p_lead_id, v_agent, v_agent_phone, v_prospect, 'requested', 'outbound'
  )
  returning id into v_call_id;

  return jsonb_build_object(
    'ok', true,
    'call_id', v_call_id,
    'lead_id', p_lead_id,
    'agent_id', v_agent,
    'business_name', v_lead.business_name,
    'agent_phone', v_agent_phone,
    'prospect_phone', v_prospect,
    'bridge_token', (select vc.bridge_token from public.voice_calls vc where vc.id = v_call_id)
  );
end
$$;

revoke all on function public.request_voice_call(uuid) from public;
grant execute on function public.request_voice_call(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. record_voice_call_result — close out the request the caller just made
--
-- The API calls this once, immediately after deciding what happened to the
-- Twilio request: accepted (`initiated`), suppressed by the kill switch
-- (`disabled`), or rejected by Twilio (`failed`).
--
-- It only moves a row out of `requested`, and only a row the caller created.
-- Once the row has any other status this returns `already_recorded` and
-- changes nothing, so an agent has exactly one write against exactly one row
-- and no way back into a call's history afterwards. Everything past this point
-- belongs to Twilio's status callback, which arrives through the service role.
--
-- p_from_number and p_twilio_call_sid are recorded as-is. Neither influences
-- dialing: the caller ID on the bridge is read from the environment at TwiML
-- time and the prospect number is read from this row, so a wrong value here
-- mislabels the caller's own record and nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.record_voice_call_result(
  p_call_id         uuid,
  p_status          text,
  p_twilio_call_sid text default null,
  p_from_number     text default null,
  p_error_message   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent  uuid;
  v_call   record;
  v_action text;
begin
  v_agent := private.current_agent_id();
  if v_agent is null then
    raise exception 'no active agent profile for the calling user'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('initiated', 'disabled', 'failed') then
    raise exception 'record_voice_call_result accepts only initiated, disabled or failed (got %)', p_status
      using errcode = 'invalid_parameter_value';
  end if;

  select vc.id, vc.status, vc.agent_id, vc.lead_id
    into v_call
  from public.voice_calls vc
  where vc.id = p_call_id;

  if not found or v_call.agent_id <> v_agent then
    return jsonb_build_object('ok', false, 'reason', 'not_your_call');
  end if;

  if v_call.status <> 'requested' then
    return jsonb_build_object('ok', false, 'reason', 'already_recorded');
  end if;

  update public.voice_calls
  set status          = p_status,
      twilio_call_sid = coalesce(p_twilio_call_sid, twilio_call_sid),
      from_number     = coalesce(p_from_number, from_number),
      error_message   = p_error_message,
      started_at      = case when p_status = 'initiated' then now() else started_at end
  where id = p_call_id;

  -- The activity trail says what was attempted, never that contact occurred.
  -- lifecycle_status and contacted_at are untouched here and stay that way:
  -- a ringing phone is not a conversation.
  v_action := case p_status
                when 'initiated' then 'lead.call_attempted'
                when 'disabled'  then 'lead.call_not_placed'
                else 'lead.call_failed'
              end;

  insert into public.activity_log (lead_id, module, action, entity_type, entity_id, details)
  values (
    v_call.lead_id, 'leads', v_action, 'lead', v_call.lead_id,
    jsonb_build_object(
      'agent_id', v_agent,
      'voice_call_id', p_call_id,
      'channel', 'twilio_voice',
      'status', p_status,
      'twilio_call_sid', p_twilio_call_sid,
      'error', p_error_message
    )
  );

  return jsonb_build_object('ok', true, 'call_id', p_call_id, 'status', p_status);
end
$$;

revoke all on function public.record_voice_call_result(uuid, text, text, text, text) from public;
grant execute on function public.record_voice_call_result(uuid, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. set_my_voice_phone — self-service for one column and one column only
--
-- Agents cannot UPDATE agent_profiles at all (00015, and that stays true), so
-- without this an admin would have to set every callback number by hand.
-- Widening the agent_profiles update policy instead would have handed agents
-- their own role, commission rate, and payout handle.
--
-- Takes the raw number and normalises it here rather than trusting a
-- pre-formatted string, so the column constraint cannot be reached with
-- something the dialer would then choke on. Passing null or blank clears it.
-- ---------------------------------------------------------------------------

create or replace function public.set_my_voice_phone(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid;
  v_norm  text;
begin
  v_agent := private.current_agent_id();
  if v_agent is null then
    raise exception 'no active agent profile for the calling user'
      using errcode = 'insufficient_privilege';
  end if;

  if p_phone is null or btrim(p_phone) = '' then
    update public.agent_profiles set voice_phone = null where id = v_agent;
    return jsonb_build_object('ok', true, 'voice_phone', null);
  end if;

  v_norm := private.normalize_phone(p_phone);
  if v_norm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  update public.agent_profiles set voice_phone = v_norm where id = v_agent;
  return jsonb_build_object('ok', true, 'voice_phone', v_norm);
end
$$;

revoke all on function public.set_my_voice_phone(text) from public;
grant execute on function public.set_my_voice_phone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Verification
--
-- The first two blocks repeat the guarantees every migration since 00015 has
-- carried. The rest are this migration's own claims: agents got a read on
-- their calls and a single-column self-edit, and nothing else — no direct
-- write to voice_calls, no widened agent_profiles policy, no recording
-- column, and nothing anywhere near the money tables.
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

  -- Every write policy on voice_calls must be the admin predicate. Anything
  -- else means an agent can create or edit a call record directly, which is
  -- the one thing this design is built to prevent.
  for r in
    select policyname, cmd from pg_policies
    where schemaname = 'public'
      and tablename = 'voice_calls'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and qual is distinct from '( SELECT private.is_admin() AS is_admin)'
      and with_check is distinct from '( SELECT private.is_admin() AS is_admin)'
  loop
    raise exception
      'Non-admin write policy on voice_calls: % (%) — writes go through request_voice_call()',
      r.policyname, r.cmd;
  end loop;

  -- agent_profiles must still be admin-write only. set_my_voice_phone() is
  -- the only path an agent has to their own row.
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

  -- All three entry points must be definer functions with a pinned search_path,
  -- or a caller-controlled search_path could redirect the lookups inside them.
  for r in
    select unnest(array[
      'request_voice_call', 'record_voice_call_result', 'set_my_voice_phone'
    ]) as fname
  loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = r.fname
        and p.prosecdef
        and exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
          where c like 'search\_path=%'
        )
    ) then
      raise exception '% must be SECURITY DEFINER with a pinned search_path', r.fname;
    end if;
  end loop;

  -- No recording in this phase. A column to put a recording in is how that
  -- decision quietly stops being true.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'voice_calls'
      and (column_name like '%recording%' or column_name like '%transcript%')
  ) then
    raise exception 'voice_calls must not carry a recording or transcript column in this phase';
  end if;

  -- Voice is a communication log. It has no business referencing money, and
  -- the ledger's append-only triggers must survive this migration untouched.
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class f on f.oid = c.confrelid
    where c.contype = 'f'
      and t.relname = 'voice_calls'
      and f.relname in ('commission_entries', 'payout_batches', 'deals', 'payments')
  ) then
    raise exception 'voice_calls must not reference the revenue tables';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname in ('commission_entries_no_update', 'commission_entries_no_delete')
      and not tgisinternal
    having count(*) = 2
  ) then
    raise exception 'the commission ledger append-only triggers are missing';
  end if;
end
$$;
