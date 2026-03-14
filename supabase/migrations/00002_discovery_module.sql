-- TweakAndBuild Lead Finder - Discovery Module
-- =============================================

-- Discovery jobs: tracks each discovery run
create table discovery_jobs (
  id            uuid primary key default uuid_generate_v4(),
  niche         text,
  city          text,
  state         text,
  keyword       text,
  source        text not null default 'manual',
  status        text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  total_found   integer not null default 0,
  imported      integer not null default 0,
  error_message text,
  created_at    timestamptz not null default now()
);

create index idx_discovery_jobs_status     on discovery_jobs (status);
create index idx_discovery_jobs_created_at on discovery_jobs (created_at desc);

-- Discovery results: staging table for found businesses before import
create table discovery_results (
  id              uuid primary key default uuid_generate_v4(),
  discovery_job_id uuid not null references discovery_jobs(id) on delete cascade,
  business_name   text not null,
  city            text,
  state           text,
  website         text,
  source          text,
  niche           text,
  imported        boolean not null default false,
  lead_id         uuid references leads(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index idx_discovery_results_job_id   on discovery_results (discovery_job_id);
create index idx_discovery_results_imported on discovery_results (imported);

-- RLS
alter table discovery_jobs enable row level security;
alter table discovery_results enable row level security;

create policy "Authenticated users can manage discovery_jobs"
  on discovery_jobs for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage discovery_results"
  on discovery_results for all
  to authenticated
  using (true)
  with check (true);
