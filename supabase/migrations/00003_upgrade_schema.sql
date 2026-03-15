-- TweakAndBuild Lead Finder - Schema Upgrade
-- =============================================
-- Adds new columns for enhanced enrichment, Google Places, API tracking,
-- saved searches, activity log, and updated status constraints.

-- ============================================
-- ALTER LEADS TABLE
-- ============================================

-- Add new columns for enhanced enrichment
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS zip text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS country text DEFAULT 'US';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_rating numeric;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_review_count integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tech_stack text[] DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_ssl boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_mobile_responsive boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_blog boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_ecommerce boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS page_load_time_ms integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_breakdown jsonb DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment_error text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS twitter text;

-- Add unique constraint on google_place_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_google_place_id ON leads (google_place_id) WHERE google_place_id IS NOT NULL;

-- Drop old lifecycle_status constraint and add new one with expanded values
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_lifecycle_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_lifecycle_status_check
  CHECK (lifecycle_status IN ('new','enriched','contacted','replied','meeting_booked','won','lost','not_a_fit'));

-- Update existing 'qualified' and 'proposal' and 'archived' statuses to map to new values
UPDATE leads SET lifecycle_status = 'enriched' WHERE lifecycle_status IN ('qualified', 'proposal');
UPDATE leads SET lifecycle_status = 'not_a_fit' WHERE lifecycle_status = 'archived';

-- Update enrichment_status to use 'crawling' instead of 'in_progress'
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_enrichment_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_enrichment_status_check
  CHECK (enrichment_status IN ('pending','crawling','in_progress','complete','completed','failed'));

-- Additional indexes
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads (city);
CREATE INDEX IF NOT EXISTS idx_leads_state ON leads (state);
CREATE INDEX IF NOT EXISTS idx_leads_industry ON leads (niche);

-- ============================================
-- SAVED SEARCHES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS saved_searches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  query text NOT NULL,
  location text,
  radius integer,
  industry text,
  last_run_at timestamptz,
  is_recurring boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_created_at ON saved_searches (created_at DESC);

-- ============================================
-- API USAGE TRACKING TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS api_usage (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  service text NOT NULL,
  endpoint text,
  cost_estimate numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_service ON api_usage (service);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage (created_at DESC);

-- ============================================
-- ACTIVITY LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  action text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_lead_id ON activity_log (lead_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at DESC);

-- ============================================
-- GOOGLE PLACES CACHE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS google_places_cache (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id text NOT NULL UNIQUE,
  raw_response jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_places_cache_place_id ON google_places_cache (place_id);
CREATE INDEX IF NOT EXISTS idx_google_places_cache_fetched_at ON google_places_cache (fetched_at);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_places_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage saved_searches"
  ON saved_searches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage api_usage"
  ON api_usage FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage activity_log"
  ON activity_log FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage google_places_cache"
  ON google_places_cache FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
