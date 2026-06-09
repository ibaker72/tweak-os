-- ============================================
-- Migration 00011: Proposals — Editable, Emailable, PDF-attachable
-- ============================================
-- Extends the existing `proposals` table to support:
--   - editable, structured sections (proposal_sections jsonb)
--   - plain-text version (proposal_text)
--   - recipient name + email for "Email Proposal"
--   - website_url + audit_id linkback
--   - sent timestamp + pdf_url
--   - 'saved' status (alongside existing draft/sent/won/lost)

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS audit_id          uuid REFERENCES lead_audits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS website_url       text,
  ADD COLUMN IF NOT EXISTS recipient_name    text,
  ADD COLUMN IF NOT EXISTS recipient_email   text,
  ADD COLUMN IF NOT EXISTS proposal_sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS proposal_text     text,
  ADD COLUMN IF NOT EXISTS pdf_url           text,
  ADD COLUMN IF NOT EXISTS sent_at           timestamptz,
  ADD COLUMN IF NOT EXISTS last_edited_at    timestamptz DEFAULT now();

-- Widen the status check to include the new 'saved' value while
-- preserving the existing draft/sent/won/lost set.
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('draft', 'saved', 'sent', 'won', 'lost'));

CREATE INDEX IF NOT EXISTS idx_proposals_audit_id        ON proposals (audit_id);
CREATE INDEX IF NOT EXISTS idx_proposals_recipient_email ON proposals (recipient_email);
CREATE INDEX IF NOT EXISTS idx_proposals_sent_at         ON proposals (sent_at DESC);
