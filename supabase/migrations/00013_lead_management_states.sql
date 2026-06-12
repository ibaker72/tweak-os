-- ============================================
-- Migration 00013: Lead Management States
-- ============================================
-- Adds soft-archive / soft-delete + previous_status tracking so leads can
-- be archived, restored, and removed from queue views without losing data.

-- 1. Drop and recreate lifecycle_status check constraint to include
--    archived/deleted in addition to the existing values.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_lifecycle_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_lifecycle_status_check
  CHECK (lifecycle_status IN (
    'new',
    'enriched',
    'contacted',
    'replied',
    'meeting_booked',
    'won',
    'lost',
    'not_a_fit',
    'archived',
    'deleted'
  ));

-- 2. Add new tracking columns (nullable so existing rows are unaffected).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS previous_status text;

-- 3. Indexes — most queries filter active leads, so partial indexes are best.
CREATE INDEX IF NOT EXISTS idx_leads_archived_at
  ON leads (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_deleted_at
  ON leads (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Helpful index for active-leads listing (the common case).
CREATE INDEX IF NOT EXISTS idx_leads_active_score
  ON leads (score DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL;
