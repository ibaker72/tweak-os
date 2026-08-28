-- ============================================================================
-- bootstrap.sql — minimal Supabase-compatible scaffolding for local RLS tests.
--
-- Supabase provides the auth schema, the auth.uid() helper and the anon /
-- authenticated / service_role roles out of the box. A bare Postgres does not,
-- so this recreates just enough of them for the migrations and the RLS suite
-- to run against a throwaway database.
--
-- auth.uid() reads the same request.jwt.claims GUC that PostgREST sets on each
-- request, so "connect as agent A" in the tests means setting that GUC and
-- switching to the authenticated role — the same path a real request takes.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create schema if not exists auth;

-- Stand-in for auth.users. Only the id column matters here; agent_profiles
-- has a foreign key to it.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Null-safe on an absent or empty GUC: an unauthenticated request has no
-- claims at all, and auth.uid() must return NULL rather than raise.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  -- service_role carries BYPASSRLS in Supabase; that is what makes it usable
  -- for webhooks and cron and what makes it dangerous in user-facing routes.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to authenticated, service_role;
