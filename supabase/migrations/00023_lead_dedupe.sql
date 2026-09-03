-- ============================================================================
-- 00023_lead_dedupe.sql
--
-- A partner keeps prospects in a Google Sheet, exports it as CSV and uploads
-- it. Later they add more rows to the SAME sheet and upload the whole thing
-- again. Every row from the first upload is in the second file, so the only
-- thing standing between the partner and a doubled pipeline is the importer
-- recognising rows it has already seen.
--
-- Before this migration it recognised them by external_id, or by
-- business_name plus state. That is too little and, in one direction, too
-- much:
--
--   * "ABC Plumbing LLC" re-exported as "ABC Plumbing, LLC" imported twice;
--   * a row whose phone, email and website all matched an existing lead
--     imported again if the name had been retyped;
--   * two rows in one file with the same phone and different spellings both
--     imported;
--   * and a row with a name but no state matched that name in EVERY state,
--     merging "ABC Plumbing" in Paterson with "ABC Plumbing" in Newark.
--
-- What this migration adds, in order:
--
--   1. normalization functions in `private`, mirroring src/lib/leads/normalize.ts
--   2. dedupe_* generated columns on public.leads, plus their indexes
--   3. private.find_duplicate_lead(), the one place the policy lives
--   4. import_jobs.invalid_rows, so "unparseable" stops being counted as "failed"
--   5. public.import_agent_leads(), rewritten around 3 and returning per-row results
--   6. public.import_bulk_leads(), the same thing for the admin importer, which
--      until now did its duplicate check over HTTP from the Next.js route
--   7. public.report_duplicate_leads(), a read-only audit of what is already
--      in the table. It reports. It does not merge or delete anything.
--
-- Nothing here deletes or rewrites a lead. The generated columns are derived
-- from data already in the row, and no unique index is created over a column
-- that existing rows might already collide on unless that is checked first.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Normalization
--
-- Every function is IMMUTABLE with a pinned empty search_path: the first
-- because generated columns and expression indexes require it, the second for
-- the reason 00015 gives.
--
-- These are mirrors of src/lib/leads/normalize.ts, function for function.
-- supabase/tests/lead-dedupe.test.ts pushes one fixture table through both
-- sides and fails on any disagreement, so the copy cannot quietly drift.
-- private.normalize_phone() already exists (00021) and is reused as-is.
-- ---------------------------------------------------------------------------

create or replace function private.normalize_external_key(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(lower(btrim(coalesce(p_raw, ''))), '');
$fn$;

create or replace function private.normalize_email_key(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text;
begin
  if p_raw is null then return null; end if;
  v := regexp_replace(lower(btrim(p_raw)), '[[:space:]]', '', 'g');
  if v = '' then return null; end if;
  -- Deliberately loose, exactly as the TypeScript is: the job is to fold
  -- TEST@Example.com onto test@example.com, not to prove the mailbox exists.
  if v ~ '^[^@]+@[^@.]+([.][^@.]+)+$' then
    return v;
  end if;
  return null;
end
$fn$;

create or replace function private.normalize_domain(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text;
begin
  if p_raw is null then return null; end if;
  v := regexp_replace(lower(btrim(p_raw)), '[[:space:]]', '', 'g');
  if v = '' then return null; end if;

  v := regexp_replace(v, '^[a-z][a-z0-9+.-]*://', '');
  v := regexp_replace(v, '^/+', '');
  -- Authority only: an '@' after the first '/' belongs to the path.
  v := substring(v from '^[^/?#]*');
  if v is null or v = '' then return null; end if;
  v := regexp_replace(v, '^.*@', '');
  v := regexp_replace(v, ':[0-9]+$', '');
  v := regexp_replace(v, '^www[.]', '');
  v := regexp_replace(v, '[.]+$', '');

  if v = '' or position('.' in v) = 0 then return null; end if;
  if v !~ '^[a-z0-9.-]+$' then return null; end if;
  if v ~ '^[.]' or v ~ '[.][.]' then return null; end if;
  -- A registrable name ends in an alphabetic TLD. Rejects bare IPs and
  -- half-typed values like "example." or "10.0.0.1".
  if v !~ '[.][a-z]{2,}$' then return null; end if;

  return v;
end
$fn$;

/*
 * Hosts that identify a platform rather than a business.
 *
 * A domain is a strong signal precisely because a business owns it. Nobody in
 * particular owns these: half the sole traders in a niche list a Gmail address
 * or a Facebook page in a Website column, and matching on one would collapse
 * them into a single lead.
 */
create or replace function private.is_shared_web_host(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_domain = any (array[
    'gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com',
    'outlook.com','live.com','msn.com','aol.com','icloud.com','me.com',
    'mac.com','protonmail.com','proton.me','mail.com','gmx.com',
    'comcast.net','verizon.net','att.net','sbcglobal.net','optonline.net',
    'facebook.com','m.facebook.com','instagram.com','linkedin.com',
    'twitter.com','x.com','tiktok.com','youtube.com','pinterest.com',
    'nextdoor.com','yelp.com','yellowpages.com','superpages.com',
    'whitepages.com','manta.com','bbb.org','angi.com','angieslist.com',
    'homeadvisor.com','thumbtack.com','houzz.com','porch.com',
    'mapquest.com','foursquare.com','tripadvisor.com','trustpilot.com',
    'chamberofcommerce.com','merchantcircle.com','citysearch.com',
    'google.com','sites.google.com','business.site','goo.gl','linktr.ee',
    'wixsite.com','wix.com','squarespace.com','godaddysites.com',
    'weebly.com','wordpress.com','blogspot.com','webnode.com',
    'myshopify.com','square.site','wordpress.org'
  ]);
$fn$;

create or replace function private.normalize_domain_key(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when d is null then null
    when private.is_shared_web_host(d) then null
    else d
  end
  from (select private.normalize_domain(p_raw) as d) s;
$fn$;

create or replace function private.is_legal_suffix_token(p_token text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_token = any (array[
    'llc','lc','llp','lp','pllc','plc','pc','pa','inc','incorporated',
    'corp','corporation','co','company','ltd','limited','gmbh','sa',
    'dba','trust','trustee'
  ]);
$fn$;

create or replace function private.normalize_business_name(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v      text;
  tokens text[];
begin
  if p_raw is null then return null; end if;

  v := lower(btrim(p_raw));
  v := replace(v, '&', ' and ');
  -- Dots and apostrophes close up ("A.B.C." -> "abc"); every other separator
  -- becomes a space, so "smith-jones" and "smith jones" agree.
  v := regexp_replace(v, '[.''‘’ʼ]', '', 'g');
  v := btrim(regexp_replace(v, '[^a-z0-9]+', ' ', 'g'));
  if v = '' then return null; end if;

  tokens := string_to_array(v, ' ');

  -- Strip trailing legal suffixes, repeatedly: sheets carry "Smith & Sons Co
  -- LLC". Never down to nothing, so a business actually called "The Company"
  -- keeps its name.
  while array_length(tokens, 1) > 1
    and private.is_legal_suffix_token(tokens[array_length(tokens, 1)])
  loop
    tokens := tokens[1 : array_length(tokens, 1) - 1];
  end loop;

  return array_to_string(tokens, ' ');
end
$fn$;

/*
 * Words that describe what a business does, not which business it is.
 *
 * The name tier only ever runs when there is no phone, email or domain to go
 * on, and a name made of nothing but these is not an identifier — a sheet of
 * "Plumbing", "Auto Repair" and "Cleaning Services" rows would otherwise
 * collapse to one lead per town.
 */
create or replace function private.is_generic_name_token(p_token text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_token = any (array[
    'the','and','of','for','a','an',
    'plumbing','plumber','plumbers','hvac','heating','cooling','air',
    'conditioning','electric','electrical','electrician','electricians',
    'roofing','roofer','roofers','landscaping','landscape','lawn','care',
    'cleaning','cleaners','cleaner','maid','janitorial','construction',
    'contracting','contractor','contractors','builders','building',
    'remodeling','renovation','restoration','painting','painters','paving',
    'concrete','masonry','flooring','carpet','tile','windows','doors',
    'fencing','decking','pool','pools','pest','control','exterminator',
    'security','locksmith','towing','auto','automotive','repair','repairs',
    'mechanic','body','shop','tire','tires','movers','moving','storage',
    'salon','spa','barber','barbers','nails','hair','beauty','massage',
    'dental','dentist','medical','clinic','health','wellness','fitness',
    'gym','studio','bakery','cafe','coffee','restaurant','pizza','pizzeria',
    'deli','catering','grill','kitchen','market','grocery','store','shop',
    'services','service','solutions','systems','group','holdings',
    'enterprises','associates','partners','brothers','sons','family',
    'professional','quality','affordable','best','local','premier'
  ]);
$fn$;

create or replace function private.normalize_name_key(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v     text;
  token text;
begin
  v := private.normalize_business_name(p_raw);
  if v is null then return null; end if;
  if length(replace(v, ' ', '')) < 3 then return null; end if;

  -- Legal suffixes count as filler here too. A name that normalizes to
  -- nothing but "llc" carries no identity, and matching two of those together
  -- would merge unrelated businesses on the strength of their paperwork.
  foreach token in array string_to_array(v, ' ')
  loop
    if not private.is_generic_name_token(token)
       and not private.is_legal_suffix_token(token) then
      return v;
    end if;
  end loop;

  return null;
end
$fn$;

create or replace function private.normalize_city_key(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_raw, ''))), '[.''‘’ʼ]', '', 'g'),
      '[^a-z0-9]+', ' ', 'g'
    )),
    ''
  );
$fn$;

create or replace function private.normalize_state_key(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text;
begin
  if p_raw is null then return null; end if;
  v := regexp_replace(lower(btrim(p_raw)), '[^a-z[:space:]]', '', 'g');
  v := btrim(regexp_replace(v, '[[:space:]]+', ' ', 'g'));
  if v = '' then return null; end if;

  -- Spelled-out states fold onto their code so "New Jersey" and "NJ" are one
  -- place. Anything unrecognised is upper-cased and kept: it still tells two
  -- rows apart, it just does not get folded.
  return case v
    when 'alabama' then 'AL' when 'alaska' then 'AK' when 'arizona' then 'AZ'
    when 'arkansas' then 'AR' when 'california' then 'CA' when 'colorado' then 'CO'
    when 'connecticut' then 'CT' when 'delaware' then 'DE' when 'florida' then 'FL'
    when 'georgia' then 'GA' when 'hawaii' then 'HI' when 'idaho' then 'ID'
    when 'illinois' then 'IL' when 'indiana' then 'IN' when 'iowa' then 'IA'
    when 'kansas' then 'KS' when 'kentucky' then 'KY' when 'louisiana' then 'LA'
    when 'maine' then 'ME' when 'maryland' then 'MD' when 'massachusetts' then 'MA'
    when 'michigan' then 'MI' when 'minnesota' then 'MN' when 'mississippi' then 'MS'
    when 'missouri' then 'MO' when 'montana' then 'MT' when 'nebraska' then 'NE'
    when 'nevada' then 'NV' when 'new hampshire' then 'NH' when 'new jersey' then 'NJ'
    when 'new mexico' then 'NM' when 'new york' then 'NY' when 'north carolina' then 'NC'
    when 'north dakota' then 'ND' when 'ohio' then 'OH' when 'oklahoma' then 'OK'
    when 'oregon' then 'OR' when 'pennsylvania' then 'PA' when 'rhode island' then 'RI'
    when 'south carolina' then 'SC' when 'south dakota' then 'SD' when 'tennessee' then 'TN'
    when 'texas' then 'TX' when 'utah' then 'UT' when 'vermont' then 'VT'
    when 'virginia' then 'VA' when 'washington' then 'WA' when 'west virginia' then 'WV'
    when 'wisconsin' then 'WI' when 'wyoming' then 'WY'
    when 'district of columbia' then 'DC' when 'puerto rico' then 'PR'
    else upper(v)
  end;
end
$fn$;

/* The composite the name tier compares on. NULL switches that tier off. */
create or replace function private.locality_key(p_city text, p_state text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when c is null and s is null then null
    else coalesce(c, '') || '|' || coalesce(s, '')
  end
  from (
    select private.normalize_city_key(p_city) as c,
           private.normalize_state_key(p_state) as s
  ) t;
$fn$;

revoke all on function private.normalize_external_key(text) from public;
revoke all on function private.normalize_email_key(text) from public;
revoke all on function private.normalize_domain(text) from public;
revoke all on function private.is_shared_web_host(text) from public;
revoke all on function private.normalize_domain_key(text) from public;
revoke all on function private.normalize_business_name(text) from public;
revoke all on function private.is_legal_suffix_token(text) from public;
revoke all on function private.is_generic_name_token(text) from public;
revoke all on function private.normalize_name_key(text) from public;
revoke all on function private.normalize_city_key(text) from public;
revoke all on function private.normalize_state_key(text) from public;
revoke all on function private.locality_key(text, text) from public;

grant execute on function private.normalize_external_key(text) to authenticated, service_role;
grant execute on function private.normalize_email_key(text) to authenticated, service_role;
grant execute on function private.normalize_domain(text) to authenticated, service_role;
grant execute on function private.is_shared_web_host(text) to authenticated, service_role;
grant execute on function private.normalize_domain_key(text) to authenticated, service_role;
grant execute on function private.normalize_business_name(text) to authenticated, service_role;
grant execute on function private.is_legal_suffix_token(text) to authenticated, service_role;
grant execute on function private.is_generic_name_token(text) to authenticated, service_role;
grant execute on function private.normalize_name_key(text) to authenticated, service_role;
grant execute on function private.normalize_city_key(text) to authenticated, service_role;
grant execute on function private.normalize_state_key(text) to authenticated, service_role;
grant execute on function private.locality_key(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Canonical columns on public.leads
--
-- Generated and STORED rather than computed at match time. Three reasons:
--
--   * every existing row gets its keys the moment this migration runs, with
--     no backfill script to forget and no window where old rows are invisible
--     to the new matcher;
--   * a key cannot drift from the value it is derived from, because Postgres
--     recomputes it on every write — including writes from paths that know
--     nothing about deduplication, like discovery and the lead detail screen;
--   * they can be indexed, so the matcher is an index probe per tier instead
--     of a sequential scan per row of a 5000-row import.
--
-- Only the columns the importers actually write are used. The enrichment
-- outputs (phone_1, email_1) are deliberately excluded: those are scraped off
-- a web page, and a shared footer number picked up from a template would
-- start suppressing genuinely new leads.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists dedupe_external text
    generated always as (private.normalize_external_key(external_id)) stored,
  add column if not exists dedupe_phone text
    generated always as (private.normalize_phone(phone)) stored,
  add column if not exists dedupe_email text
    generated always as (private.normalize_email_key(email)) stored,
  add column if not exists dedupe_domain text
    generated always as (private.normalize_domain_key(website)) stored,
  add column if not exists dedupe_name text
    generated always as (private.normalize_name_key(business_name)) stored,
  add column if not exists dedupe_city text
    generated always as (private.normalize_city_key(city)) stored,
  add column if not exists dedupe_state text
    generated always as (private.normalize_state_key(state)) stored;

-- Partial: a null key means "this row cannot be matched on this tier", and
-- there is no point indexing millions of them.
create index if not exists idx_leads_dedupe_external
  on public.leads (dedupe_external) where dedupe_external is not null;
create index if not exists idx_leads_dedupe_phone
  on public.leads (dedupe_phone) where dedupe_phone is not null;
create index if not exists idx_leads_dedupe_email
  on public.leads (dedupe_email) where dedupe_email is not null;
create index if not exists idx_leads_dedupe_domain
  on public.leads (dedupe_domain) where dedupe_domain is not null;
create index if not exists idx_leads_dedupe_name
  on public.leads (dedupe_name, dedupe_city, dedupe_state)
  where dedupe_name is not null;

-- ---------------------------------------------------------------------------
-- The one uniqueness the database enforces by itself.
--
-- external_id is an identifier some other system assigned to a business. Two
-- leads carrying the same one are the same business by definition, with no
-- franchise, generic-name or shared-domain case to get wrong — so it is the
-- only tier safe to make a hard constraint.
--
-- The other tiers stay advisory. A unique index on a phone number would turn
-- a legitimate second location behind one answering service into a failed
-- write, and a unique index on a name would be wrong outright. Concurrency for
-- those is handled where it actually arises, by the import lock in section 5.
--
-- Created only if the table is already clean. A unique index cannot be built
-- over existing collisions, and this migration is not allowed to resolve them
-- by deleting anything — public.report_duplicate_leads() below exists so an
-- operator can see what is there and decide. If the index is skipped, the
-- importer still dedupes; it just has one less backstop.
-- ---------------------------------------------------------------------------
do $$
declare
  v_collisions bigint;
begin
  select count(*) into v_collisions
  from (
    select dedupe_external
    from public.leads
    where dedupe_external is not null
    group by dedupe_external
    having count(*) > 1
  ) d;

  if v_collisions = 0 then
    create unique index if not exists leads_dedupe_external_uk
      on public.leads (dedupe_external) where dedupe_external is not null;
  else
    raise notice
      'Skipped leads_dedupe_external_uk: % external_id value(s) are already duplicated. '
      'Run select * from public.report_duplicate_leads() and clean up, then create it by hand.',
      v_collisions;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. import_jobs.invalid_rows
--
-- The counts were imported / skipped / failed, and "failed" carried two very
-- different things: a row the CSV parser rejected because it had no business
-- name, and a row that blew up on INSERT. The first is the partner's sheet to
-- fix; the second is ours. Splitting them is the difference between a summary
-- someone can act on and one they cannot.
--
-- Existing rows get 0, which is what they were before — their invalid rows
-- are already counted in failed_rows and are left there.
-- ---------------------------------------------------------------------------
alter table public.import_jobs
  add column if not exists invalid_rows integer not null default 0;

-- ---------------------------------------------------------------------------
-- 4. private.find_duplicate_lead — the policy, in one place
--
-- Takes a raw CSV row's fields, normalizes them with the functions above, and
-- returns the lead it duplicates, or nothing.
--
-- Tiers are tried in strength order:
--
--   1. external_id     an identifier another system assigned. Unconditional.
--   2. phone           one business answers one line. Unconditional.
--   3. email           owned, but a franchise can share an info@ address.
--   4. domain          owned, but a franchise can share a corporate site.
--   5. name + location the fallback, and the only tier that could merge two
--                      real businesses, so it is last and strictest.
--
-- Tiers 3, 4 and 5 all defer to a stated disagreement about where the
-- business is: two rows that both name a city, and name different ones, are
-- two locations of one brand rather than one lead typed twice. So "ABC
-- Plumbing" in Paterson and "ABC Plumbing" in Newark stay two businesses, and
-- a franchise sharing one corporate domain or one info@ address stays as many
-- leads as it has branches.
--
-- A MISSING city or state is not a disagreement. The same sheet re-exported
-- often drops a column, and treating unknown as different is exactly what
-- would let the duplicate through — worse, it would let a second partner
-- import a business that already belongs to a colleague and claim credit for
-- it. Unknown defers to the identifier that IS present.
--
-- What keeps tier 5 honest is not a location requirement but the name key
-- itself: private.normalize_name_key() returns NULL for a name made only of
-- words describing the trade, so a sheet of "Plumbing" and "Auto Repair" rows
-- never reaches this tier at all.
--
-- Reads every lead in the table, not the ones the caller may see. Two partners
-- importing the same business is precisely the case that makes commission
-- attribution ambiguous, and scoping the check to the caller's own leads is
-- what would let it happen.
--
-- Ties break to the OLDEST lead: that is the row whose attribution came first,
-- and it is the one the importer must skip against.
-- ---------------------------------------------------------------------------

create or replace function private.locality_key_of(p_city_key text, p_state_key text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_city_key is null and p_state_key is null then null
    else coalesce(p_city_key, '') || '|' || coalesce(p_state_key, '')
  end;
$fn$;

/* True only when both sides state a location and the statements disagree. */
create or replace function private.locality_conflicts(
  p_city_a text, p_state_a text, p_city_b text, p_state_b text
)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select (p_city_a is not null and p_city_b is not null and p_city_a <> p_city_b)
      or (p_state_a is not null and p_state_b is not null and p_state_a <> p_state_b);
$fn$;

create or replace function private.find_duplicate_lead(
  p_business_name text,
  p_city          text default null,
  p_state         text default null,
  p_website       text default null,
  p_email         text default null,
  p_phone         text default null,
  p_external_id   text default null
)
returns table (lead_id uuid, matched_by text, owner_agent_id uuid)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  k_external text := private.normalize_external_key(p_external_id);
  k_phone    text := private.normalize_phone(p_phone);
  k_email    text := private.normalize_email_key(p_email);
  k_domain   text := private.normalize_domain_key(p_website);
  k_name     text := private.normalize_name_key(p_business_name);
  k_city     text := private.normalize_city_key(p_city);
  k_state    text := private.normalize_state_key(p_state);
begin
  return query
  with matches as (
    select 1 as tier, l.id, 'external_id'::text as reason, l.assigned_to, l.created_at
    from public.leads l
    where k_external is not null and l.dedupe_external = k_external

    union all
    select 2, l.id, 'phone', l.assigned_to, l.created_at
    from public.leads l
    where k_phone is not null and l.dedupe_phone = k_phone

    union all
    select 3, l.id, 'email', l.assigned_to, l.created_at
    from public.leads l
    where k_email is not null
      and l.dedupe_email = k_email
      and not private.locality_conflicts(k_city, k_state, l.dedupe_city, l.dedupe_state)

    union all
    select 4, l.id, 'domain', l.assigned_to, l.created_at
    from public.leads l
    where k_domain is not null
      and l.dedupe_domain = k_domain
      and not private.locality_conflicts(k_city, k_state, l.dedupe_city, l.dedupe_state)

    union all
    select 5, l.id, 'name_location', l.assigned_to, l.created_at
    from public.leads l
    where k_name is not null
      and l.dedupe_name = k_name
      and not private.locality_conflicts(k_city, k_state, l.dedupe_city, l.dedupe_state)
  )
  select m.id, m.reason, m.assigned_to
  from matches m
  order by m.tier, m.created_at, m.id
  limit 1;
end
$fn$;

revoke all on function private.locality_key_of(text, text) from public;
revoke all on function private.locality_conflicts(text, text, text, text) from public;
revoke all on function private.find_duplicate_lead(text, text, text, text, text, text, text) from public;

grant execute on function private.locality_key_of(text, text) to authenticated, service_role;
grant execute on function private.locality_conflicts(text, text, text, text) to authenticated, service_role;
grant execute on function private.find_duplicate_lead(text, text, text, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The importers
--
-- Both follow the same shape and differ only in who ends up owning the lead:
--
--   import_agent_leads  — any active agent. Assigns the lead to the caller and
--                         writes a self_sourced attribution. Identity comes
--                         from the JWT; there is no agent parameter to forge.
--   import_bulk_leads   — admins only. Leaves the lead unassigned and writes
--                         no attribution, because a bulk upload sources for
--                         the team rather than for whoever ran it.
--
-- They are separate functions rather than one with a mode flag on purpose. A
-- flag is a parameter, and a parameter that decides ownership is a parameter
-- worth forging. What they DO share — normalization and the duplicate policy —
-- is shared, in private.find_duplicate_lead().
--
-- Concurrency: each takes one transaction-level advisory lock over the whole
-- import. Without it, two partners uploading overlapping sheets at the same
-- moment both see "no existing lead", and both insert. The alternative — a
-- unique index on every tier — cannot be built (see section 2), so the writes
-- are serialised instead. Imports are a handful of files a day, bounded at
-- 5000 rows, and a queued upload is cheaper than a duplicated pipeline.
-- ---------------------------------------------------------------------------

/* One well-known key, so every import path queues behind the same lock. */
create or replace function private.lead_import_lock_key()
returns bigint
language sql
immutable
set search_path = ''
as $fn$ select 4291500023::bigint; $fn$;

/* A date the CSV may or may not have supplied in a shape Postgres accepts. */
create or replace function private.safe_date(p_raw text)
returns date
language plpgsql
stable
set search_path = ''
as $fn$
begin
  return nullif(btrim(coalesce(p_raw, '')), '')::date;
exception
  when others then
    return null;
end
$fn$;

revoke all on function private.lead_import_lock_key() from public;
revoke all on function private.safe_date(text) from public;
grant execute on function private.lead_import_lock_key() to authenticated, service_role;
grant execute on function private.safe_date(text) to authenticated, service_role;

drop function if exists public.import_agent_leads(jsonb, text, integer);

create or replace function public.import_agent_leads(
  p_rows           jsonb,
  p_filename       text    default 'agent-import.csv',
  -- How many rows the CSV parser rejected before this call. Display only: it
  -- is added to the job's total and invalid counts so the import job matches
  -- what the agent uploaded rather than only what survived parsing. It cannot
  -- touch ownership, credit, or which rows are written.
  p_parse_failures integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- How many per-row results come back. The counts are always exact; this
  -- only bounds the detail list, so a 5000-row upload cannot return megabytes
  -- of JSON to a phone browser.
  c_max_results constant integer := 250;

  v_agent      uuid;
  v_job_id     uuid;
  v_row        jsonb;
  v_total      integer;
  v_imported   integer := 0;
  v_duplicate  integer := 0;
  v_invalid    integer := 0;
  v_failed     integer := 0;
  v_results    jsonb := '[]'::jsonb;
  v_failures   jsonb := '[]'::jsonb;
  v_index      integer := 0;
  v_rejected   integer;
  v_name       text;
  v_lead_id    uuid;
  v_dup        record;
  v_now        timestamptz := now();
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

  perform pg_advisory_xact_lock(private.lead_import_lock_key());

  insert into public.import_jobs (
    filename, total_rows, status, created_by, source
  )
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
      v_invalid := v_invalid + 1;
      v_failures := v_failures || jsonb_build_object(
        'row', v_index, 'message', 'Business name is required'
      );
      if jsonb_array_length(v_results) < c_max_results then
        v_results := v_results || jsonb_build_object(
          'row', v_index,
          'business_name', null,
          'status', 'invalid',
          'message', 'Business name is required'
        );
      end if;
      continue;
    end if;

    -- Sees leads already written by earlier rows of THIS file, because they
    -- are in this transaction. That is what makes two spellings of one
    -- business inside one sheet resolve to a single lead.
    select * into v_dup
    from private.find_duplicate_lead(
      v_name,
      v_row ->> 'city',
      v_row ->> 'state',
      v_row ->> 'website',
      v_row ->> 'email',
      v_row ->> 'phone',
      v_row ->> 'external_id'
    );

    if v_dup.lead_id is not null then
      -- Skip means skip. No second lead, no second attribution, no touching
      -- the existing lead's owner, status, enrichment or history. If it
      -- belongs to another agent it stays theirs — silently reassigning a
      -- lead because someone re-uploaded a sheet is how two people end up
      -- claiming one commission.
      v_duplicate := v_duplicate + 1;
      if jsonb_array_length(v_results) < c_max_results then
        v_results := v_results || jsonb_build_object(
          'row', v_index,
          'business_name', v_name,
          'status', 'duplicate_skipped',
          'reason', v_dup.matched_by,
          'owned_by_other_agent',
            v_dup.owner_agent_id is not null and v_dup.owner_agent_id <> v_agent
        );
      end if;
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
        nullif(btrim(coalesce(v_row ->> 'state', '')), ''),
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
        nullif(btrim(coalesce(v_row ->> 'external_id', '')), ''),
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
      if jsonb_array_length(v_results) < c_max_results then
        v_results := v_results || jsonb_build_object(
          'row', v_index,
          'business_name', v_name,
          'status', 'imported',
          'lead_id', v_lead_id
        );
      end if;
    exception
      when others then
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'row', v_index,
          'message', format('Failed to import %s: %s', v_name, sqlerrm)
        );
        if jsonb_array_length(v_results) < c_max_results then
          v_results := v_results || jsonb_build_object(
            'row', v_index,
            'business_name', v_name,
            'status', 'failed',
            'message', sqlerrm
          );
        end if;
    end;
  end loop;

  update public.import_jobs
  set imported_rows = v_imported,
      skipped_rows  = v_duplicate,
      invalid_rows  = v_invalid + v_rejected,
      failed_rows   = v_failed,
      status        = 'completed'
  where id = v_job_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'total_rows', v_total + v_rejected,
    'imported_rows', v_imported,
    'skipped_duplicates', v_duplicate,
    'invalid_rows', v_invalid + v_rejected,
    'failed_rows', v_failed,
    'credited_to', v_agent,
    'results', v_results,
    'results_truncated', (v_total > jsonb_array_length(v_results)),
    'failures', v_failures
  );
end
$fn$;

revoke all on function public.import_agent_leads(jsonb, text, integer) from public;
grant execute on function public.import_agent_leads(jsonb, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. public.import_bulk_leads — the admin importer
--
-- POST /api/imports used to run its duplicate check from the Next.js process:
-- one PostgREST round trip per row to ask "does this exist", then another to
-- insert. That is two problems. The check and the insert were separate
-- statements in separate transactions, so two overlapping uploads raced; and
-- the check itself used ILIKE on the raw business_name, where a `%` or `_` in
-- a company's name is a wildcard — "100% Roofing" matched businesses that
-- merely started with "100" and ended in " Roofing".
--
-- Moving it here puts the admin path on exactly the same policy as the agent
-- path, in one transaction, behind the same lock.
--
-- What it deliberately does NOT do is assign or credit anyone. A bulk upload
-- sources for the team; if it wrote attributions, every row would look
-- self-sourced by whoever happened to run the upload.
-- ---------------------------------------------------------------------------

create or replace function public.import_bulk_leads(
  p_rows           jsonb,
  p_filename       text    default 'import.csv',
  p_parse_failures integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_max_results constant integer := 250;

  v_job_id     uuid;
  v_row        jsonb;
  v_total      integer;
  v_imported   integer := 0;
  v_duplicate  integer := 0;
  v_invalid    integer := 0;
  v_failed     integer := 0;
  v_results    jsonb := '[]'::jsonb;
  v_failures   jsonb := '[]'::jsonb;
  v_index      integer := 0;
  v_rejected   integer;
  v_name       text;
  v_lead_id    uuid;
  v_dup        record;
begin
  if not private.is_admin() then
    raise exception 'only an admin may run a bulk import'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  v_rejected := greatest(coalesce(p_parse_failures, 0), 0);
  v_total := jsonb_array_length(p_rows);

  if v_total > 5000 then
    raise exception 'import is limited to 5000 rows per file (got %)', v_total
      using errcode = 'program_limit_exceeded';
  end if;

  perform pg_advisory_xact_lock(private.lead_import_lock_key());

  insert into public.import_jobs (
    filename, total_rows, status, created_by, source
  )
  values (
    coalesce(nullif(btrim(p_filename), ''), 'import.csv'),
    v_total + v_rejected,
    'processing',
    private.current_agent_id(),
    'admin_upload'
  )
  returning id into v_job_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_name := nullif(btrim(coalesce(v_row ->> 'business_name', '')), '');

    if v_name is null then
      v_invalid := v_invalid + 1;
      v_failures := v_failures || jsonb_build_object(
        'row', v_index, 'message', 'Business name is required'
      );
      if jsonb_array_length(v_results) < c_max_results then
        v_results := v_results || jsonb_build_object(
          'row', v_index, 'business_name', null,
          'status', 'invalid', 'message', 'Business name is required'
        );
      end if;
      continue;
    end if;

    select * into v_dup
    from private.find_duplicate_lead(
      v_name,
      v_row ->> 'city',
      v_row ->> 'state',
      v_row ->> 'website',
      v_row ->> 'email',
      v_row ->> 'phone',
      v_row ->> 'external_id'
    );

    if v_dup.lead_id is not null then
      -- Existing lead untouched: same owner, same status, same enrichment,
      -- same history. An admin re-uploading a sheet must not quietly pull a
      -- lead back off the agent who is working it.
      v_duplicate := v_duplicate + 1;
      if jsonb_array_length(v_results) < c_max_results then
        v_results := v_results || jsonb_build_object(
          'row', v_index,
          'business_name', v_name,
          'status', 'duplicate_skipped',
          'reason', v_dup.matched_by,
          'owned_by_other_agent', v_dup.owner_agent_id is not null
        );
      end if;
      continue;
    end if;

    begin
      insert into public.leads (
        business_name, city, state, address, zip, website, email, phone,
        contact_name, manual_notes, niche, source, external_id,
        entity_type, entity_status, registered_agent, source_filing_date,
        import_notes,
        lifecycle_status, enrichment_status, score, reasons, score_breakdown,
        tech_stack, social_links
      ) values (
        v_name,
        nullif(btrim(coalesce(v_row ->> 'city', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'state', '')), ''),
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
        nullif(btrim(coalesce(v_row ->> 'source', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'external_id', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'entity_type', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'entity_status', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'registered_agent', '')), ''),
        private.safe_date(v_row ->> 'source_filing_date'),
        nullif(btrim(coalesce(v_row ->> 'import_notes', '')), ''),
        'new', 'pending', 0, '[]'::jsonb, '{}'::jsonb,
        '{}'::text[], '{}'::jsonb
      )
      returning id into v_lead_id;

      v_imported := v_imported + 1;
      if jsonb_array_length(v_results) < c_max_results then
        v_results := v_results || jsonb_build_object(
          'row', v_index, 'business_name', v_name,
          'status', 'imported', 'lead_id', v_lead_id
        );
      end if;
    exception
      when others then
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'row', v_index,
          'message', format('Failed to import %s: %s', v_name, sqlerrm)
        );
        if jsonb_array_length(v_results) < c_max_results then
          v_results := v_results || jsonb_build_object(
            'row', v_index, 'business_name', v_name,
            'status', 'failed', 'message', sqlerrm
          );
        end if;
    end;
  end loop;

  update public.import_jobs
  set imported_rows = v_imported,
      skipped_rows  = v_duplicate,
      invalid_rows  = v_invalid + v_rejected,
      failed_rows   = v_failed,
      status        = 'completed'
  where id = v_job_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'total_rows', v_total + v_rejected,
    'imported_rows', v_imported,
    'skipped_duplicates', v_duplicate,
    'invalid_rows', v_invalid + v_rejected,
    'failed_rows', v_failed,
    'results', v_results,
    'results_truncated', (v_total > jsonb_array_length(v_results)),
    'failures', v_failures
  );
end
$fn$;

revoke all on function public.import_bulk_leads(jsonb, text, integer) from public;
grant execute on function public.import_bulk_leads(jsonb, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. public.report_duplicate_leads — read-only audit of what is already there
--
-- The importer stops NEW duplicates. It says nothing about the ones a year of
-- uploads under the old rules may already have created, and this migration
-- must not decide their fate: a lead has an owner, an attribution, an
-- outreach history and possibly a commission attached to it, and merging two
-- of them is a business decision, not a schema change.
--
-- So this reports and stops. Every row it returns names a lead, the older
-- lead it duplicates, which tier matched, and who owns each — enough to
-- decide, nothing that acts. There is no delete and no merge anywhere in this
-- migration.
--
-- Each pair is listed once, from the newer lead, because
-- find_duplicate_lead() resolves to the oldest match and the oldest lead of a
-- cluster therefore resolves to itself.
-- ---------------------------------------------------------------------------

create or replace function public.report_duplicate_leads(p_limit integer default 500)
returns table (
  lead_id            uuid,
  business_name      text,
  city               text,
  state              text,
  created_at         timestamptz,
  matched_by         text,
  duplicate_of       uuid,
  duplicate_of_name  text,
  lead_owner         uuid,
  duplicate_of_owner uuid,
  same_owner         boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not private.is_admin() then
    raise exception 'only an admin may audit duplicate leads'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select l.id, l.business_name, l.city, l.state, l.created_at,
         d.matched_by, d.lead_id, o.business_name,
         l.assigned_to, o.assigned_to,
         l.assigned_to is not distinct from o.assigned_to
  from public.leads l
  cross join lateral private.find_duplicate_lead(
    l.business_name, l.city, l.state, l.website, l.email, l.phone, l.external_id
  ) d
  join public.leads o on o.id = d.lead_id
  where d.lead_id <> l.id
  order by l.created_at desc
  limit greatest(coalesce(p_limit, 500), 1);
end
$fn$;

/* The same audit reduced to counts, for a one-line "is this a problem" answer. */
create or replace function public.count_duplicate_leads()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'only an admin may audit duplicate leads'
      using errcode = 'insufficient_privilege';
  end if;

  with dupes as (
    select d.matched_by,
           l.assigned_to as lead_owner,
           o.assigned_to as original_owner
    from public.leads l
    cross join lateral private.find_duplicate_lead(
      l.business_name, l.city, l.state, l.website, l.email, l.phone, l.external_id
    ) d
    join public.leads o on o.id = d.lead_id
    where d.lead_id <> l.id
  )
  select jsonb_build_object(
    'total_leads', (select count(*) from public.leads),
    'duplicate_leads', (select count(*) from dupes),
    'cross_owner_duplicates',
      (select count(*) from dupes where lead_owner is distinct from original_owner),
    'by_tier', coalesce(
      (select jsonb_object_agg(t.matched_by, t.n)
       from (select matched_by, count(*) as n from dupes group by matched_by) t),
      '{}'::jsonb
    )
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object(
    'total_leads', (select count(*) from public.leads),
    'duplicate_leads', 0, 'cross_owner_duplicates', 0, 'by_tier', '{}'::jsonb
  ));
end
$fn$;

revoke all on function public.report_duplicate_leads(integer) from public;
revoke all on function public.count_duplicate_leads() from public;
grant execute on function public.report_duplicate_leads(integer) to authenticated, service_role;
grant execute on function public.count_duplicate_leads() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Verification
--
-- The first three blocks repeat 00015's and 00020's guarantees: this
-- migration adds a second definer importer, and the point is that it widens
-- nothing. The rest are this migration's own claims.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_generated integer;
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

  -- Still no direct write on leads or attributions for anyone but an admin.
  -- The two importers are the only other way in.
  for r in
    select tablename, policyname, cmd from pg_policies
    where schemaname = 'public'
      and tablename in ('leads', 'attributions')
      and cmd in ('INSERT', 'DELETE')
      and qual is distinct from '( SELECT private.is_admin() AS is_admin)'
      and with_check is distinct from '( SELECT private.is_admin() AS is_admin)'
  loop
    raise exception
      'Non-admin write policy on %.%: % — imports must go through the definer functions',
      r.tablename, r.policyname, r.cmd;
  end loop;

  -- Both importers, and both audit functions, are definer with a pinned path.
  for r in
    select unnest(array[
      'import_agent_leads', 'import_bulk_leads',
      'report_duplicate_leads', 'count_duplicate_leads'
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
      raise exception
        'public.% must be SECURITY DEFINER with a pinned empty search_path', r.fname;
    end if;
  end loop;

  -- Neither importer may grow a parameter that names who gets the credit.
  for r in
    select p.proname, p.proargnames from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('import_agent_leads', 'import_bulk_leads')
  loop
    if exists (
      select 1 from unnest(coalesce(r.proargnames, array[]::text[])) a
      where a ~* 'agent|assign|owner|credit|attribution'
    ) then
      raise exception
        'public.% has an ownership parameter — credit must come from the JWT', r.proname;
    end if;
  end loop;

  -- The dedupe keys must be GENERATED. A plain column would be one more thing
  -- for a write path to forget to maintain, and a stale key is a duplicate.
  select count(*) into v_generated
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'leads'
    and column_name in (
      'dedupe_external', 'dedupe_phone', 'dedupe_email', 'dedupe_domain',
      'dedupe_name', 'dedupe_city', 'dedupe_state'
    )
    and is_generated = 'ALWAYS';

  if v_generated <> 7 then
    raise exception
      'expected 7 generated dedupe columns on public.leads, found %', v_generated;
  end if;
end
$$;
