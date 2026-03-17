-- Performance grade from enrichment
ALTER TABLE leads ADD COLUMN IF NOT EXISTS performance_grade text;

-- Index for follow-up queries
CREATE INDEX IF NOT EXISTS idx_leads_contacted_at ON leads (contacted_at) WHERE contacted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lifecycle_contacted ON leads (lifecycle_status, contacted_at) WHERE lifecycle_status = 'contacted';
