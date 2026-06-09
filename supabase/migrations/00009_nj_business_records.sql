-- ============================================
-- Migration 00009: NJ Business Records Import Support
-- ============================================
-- Adds columns to support importing NJ Business Entity List CSV exports
-- and other state business registry sources.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_status text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS registered_agent text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_filing_date date;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS import_notes text;

CREATE INDEX IF NOT EXISTS idx_leads_external_id
  ON leads (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_business_name_state
  ON leads (business_name, state);
CREATE INDEX IF NOT EXISTS idx_leads_entity_status
  ON leads (entity_status) WHERE entity_status IS NOT NULL;
