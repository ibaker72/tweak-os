-- ============================================
-- Migration 00008: Lead Audits and Proposals
-- ============================================
-- Adds two new tables:
--   - lead_audits: stores AI-generated SEO/conversion audits for any URL
--   - proposals:  stores AI-generated proposals tied to leads + services

-- ============================================
-- LEAD AUDITS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS lead_audits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url               text NOT NULL,
  audit_json        jsonb,
  opportunity_grade text CHECK (opportunity_grade IN ('A+','A','B','C')),
  overall_score     integer,
  lead_id           uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_audits_url        ON lead_audits (url);
CREATE INDEX IF NOT EXISTS idx_lead_audits_lead_id    ON lead_audits (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_audits_created_at ON lead_audits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_audits_grade      ON lead_audits (opportunity_grade);

ALTER TABLE lead_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage lead_audits"
  ON lead_audits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================
-- PROPOSALS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  client_name     text,
  business_type   text,
  services_json   jsonb,
  proposal_html   text,
  total_one_time  numeric DEFAULT 0,
  total_monthly   numeric DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','won','lost')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_lead_id    ON proposals (lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status     ON proposals (status);
CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals (created_at DESC);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage proposals"
  ON proposals FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
