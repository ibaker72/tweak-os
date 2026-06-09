-- ============================================
-- Migration 00010: NJ Enrichment & Import Improvements
-- ============================================
-- Splits imported/skipped/failed in import_jobs (previously duplicates
-- were lumped into failed_rows). Adds enrichment-result columns to leads
-- so we can record the outcome of enrichment runs that find no public
-- website or contact info — important for newly-formed NJ businesses
-- that don't have a website yet but are still good launch-kit leads.

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS skipped_rows int NOT NULL DEFAULT 0;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_status text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS online_presence text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment_summary text;

CREATE INDEX IF NOT EXISTS idx_leads_contact_status
  ON leads (contact_status) WHERE contact_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_online_presence
  ON leads (online_presence) WHERE online_presence IS NOT NULL;
