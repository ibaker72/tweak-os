-- TweakAndBuild Lead Finder - Initial Schema
-- ============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- LEADS TABLE
-- ============================================
create table leads (
  id            uuid primary key default uuid_generate_v4(),
  business_name text not null,
  city          text,
  state         text,
  website       text,
  source        text,
  niche         text,

  -- Lifecycle
  lifecycle_status   text not null default 'new'
    check (lifecycle_status in ('new','contacted','qualified','proposal','won','lost','archived')),
  enrichment_status  text not null default 'pending'
    check (enrichment_status in ('pending','in_progress','completed','failed')),

  -- Enrichment fields
  page_title    text,
  email_1       text,
  email_2       text,
  phone_1       text,
  phone_2       text,
  contact_page  text,
  facebook      text,
  instagram     text,
  linkedin      text,

  -- Scoring
  score         integer default 0,
  reasons       jsonb default '[]'::jsonb,

  -- Outreach insights
  pain_point_1        text,
  pain_point_2        text,
  offer_angle         text,
  suggested_first_line text,

  -- Notes
  manual_notes  text,

  -- Timestamps
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Indexes for leads
create index idx_leads_lifecycle_status  on leads (lifecycle_status);
create index idx_leads_enrichment_status on leads (enrichment_status);
create index idx_leads_score             on leads (score desc);
create index idx_leads_niche             on leads (niche);
create index idx_leads_business_name     on leads (business_name);
create index idx_leads_website           on leads (website);
create index idx_leads_created_at        on leads (created_at desc);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- ============================================
-- IMPORT JOBS TABLE
-- ============================================
create table import_jobs (
  id            uuid primary key default uuid_generate_v4(),
  filename      text not null,
  total_rows    integer not null default 0,
  imported_rows integer not null default 0,
  failed_rows   integer not null default 0,
  status        text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  created_at    timestamptz not null default now()
);

create index idx_import_jobs_status     on import_jobs (status);
create index idx_import_jobs_created_at on import_jobs (created_at desc);

-- ============================================
-- ENRICHMENT JOBS TABLE
-- ============================================
create table enrichment_jobs (
  id            uuid primary key default uuid_generate_v4(),
  lead_id       uuid not null references leads(id) on delete cascade,
  status        text not null default 'pending'
    check (status in ('pending','in_progress','completed','failed')),
  error_message text,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_enrichment_jobs_lead_id    on enrichment_jobs (lead_id);
create index idx_enrichment_jobs_status     on enrichment_jobs (status);
create index idx_enrichment_jobs_created_at on enrichment_jobs (created_at desc);

-- ============================================
-- ROW LEVEL SECURITY (basic - expand later)
-- ============================================
alter table leads enable row level security;
alter table import_jobs enable row level security;
alter table enrichment_jobs enable row level security;

-- Allow authenticated users full access (internal tool)
create policy "Authenticated users can manage leads"
  on leads for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage import_jobs"
  on import_jobs for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage enrichment_jobs"
  on enrichment_jobs for all
  to authenticated
  using (true)
  with check (true);
