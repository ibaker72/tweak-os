-- ============================================
-- Migration 00007: Automation Proxy Hub
-- ============================================
-- Enables app.tweakandbuild.com to act as a centralized proxy
-- between multiple client sites and the OpenClaw API.

-- 7.1 Site Configurations
-- One row per client site. Controls access and routing.
CREATE TABLE IF NOT EXISTS site_configs (
  id                  uuid  PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain              text  NOT NULL UNIQUE,        -- e.g. "gopro-hvac.com" (display/audit only)
  client_secret       text  NOT NULL UNIQUE,        -- the x-tweak-api-key value for this site
  openclaw_skill_id   text  NOT NULL,               -- which OpenClaw skill to trigger
  target_email        text  NOT NULL,               -- where the lead notification goes
  is_active           boolean NOT NULL DEFAULT true, -- flip to false to instantly cut off a client
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Partial index: lookups always filter on is_active = true
CREATE INDEX IF NOT EXISTS idx_site_configs_client_secret
  ON site_configs (client_secret) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_site_configs_domain
  ON site_configs (domain);

CREATE TRIGGER site_configs_updated_at
  BEFORE UPDATE ON site_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 7.2 Automation Logs
-- Audit trail for every inbound request — successes, failures, and rejected keys.
-- Powers the cross-site lead dashboard in the Hub.
CREATE TABLE IF NOT EXISTS automation_logs (
  id                  uuid  PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_config_id      uuid  REFERENCES site_configs(id) ON DELETE SET NULL,
  domain              text,                         -- snapshot so logs survive config deletion
  status              text  NOT NULL CHECK (status IN ('success', 'failed', 'rejected')),
  error_message       text,
  payload             jsonb,                        -- the lead data that was submitted
  openclaw_response   jsonb,                        -- raw OpenClaw API response
  ip_address          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_site_config_id
  ON automation_logs (site_config_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_status
  ON automation_logs (status);
CREATE INDEX IF NOT EXISTS idx_automation_logs_created_at
  ON automation_logs (created_at DESC);

-- 7.3 Row Level Security
-- The proxy route uses the service role key (bypasses RLS).
-- Authenticated dashboard users get read access to both tables.
ALTER TABLE site_configs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage site_configs"
  ON site_configs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view automation_logs"
  ON automation_logs FOR SELECT TO authenticated
  USING (true);

-- Service role inserts into automation_logs (API route).
-- Service role bypasses RLS automatically — no policy needed.
