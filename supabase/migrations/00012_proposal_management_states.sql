-- ============================================
-- Migration 00012: Proposal management states
-- ============================================
-- Adds the "active", "obsolete", and "archived" lifecycle states so the
-- OpenClaw proposal management endpoints can update, supersede, and soft
-- delete proposals without ever hard-deleting rows.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN (
    'draft',
    'saved',
    'sent',
    'won',
    'lost',
    'active',
    'obsolete',
    'archived'
  ));

CREATE INDEX IF NOT EXISTS idx_proposals_archived_at ON proposals (archived_at DESC);
