-- ============================================
-- Migration 00006: Agent System, Outreach Sequences, Smart Lists
-- ============================================

-- 1.1 Agent Profiles
CREATE TABLE IF NOT EXISTS agent_profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  avatar_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_user_id ON agent_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_role ON agent_profiles (role);

CREATE TRIGGER agent_profiles_updated_at
  BEFORE UPDATE ON agent_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add assignment columns to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES agent_profiles(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action_date date;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_via text CHECK (last_contacted_via IN ('email', 'linkedin', 'phone', 'other'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_count integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_next_action_date ON leads (next_action_date) WHERE next_action_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads (priority);

-- 1.2 Outreach Sequences
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agent_profiles(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'linkedin', 'phone', 'other')),
  sequence_step integer NOT NULL DEFAULT 1,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'opened', 'replied', 'bounced')),
  sent_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,
  scheduled_for timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_sequences_lead_id ON outreach_sequences (lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_agent_id ON outreach_sequences (agent_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_status ON outreach_sequences (status);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_scheduled_for ON outreach_sequences (scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_sent_at ON outreach_sequences (sent_at DESC);

CREATE TRIGGER outreach_sequences_updated_at
  BEFORE UPDATE ON outreach_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.2b Outreach Templates
CREATE TABLE IF NOT EXISTS outreach_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'linkedin', 'phone', 'follow_up')),
  subject text,
  body text NOT NULL,
  variables text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER outreach_templates_updated_at
  BEFORE UPDATE ON outreach_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.3 Smart Lists
CREATE TABLE IF NOT EXISTS smart_lists (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  icon text DEFAULT 'list',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_by text DEFAULT 'score',
  sort_order text DEFAULT 'desc',
  is_pinned boolean DEFAULT false,
  color text,
  created_by uuid REFERENCES agent_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER smart_lists_updated_at
  BEFORE UPDATE ON smart_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.4 RLS Policies
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage agent_profiles"
  ON agent_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage outreach_sequences"
  ON outreach_sequences FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage outreach_templates"
  ON outreach_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage smart_lists"
  ON smart_lists FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed default outreach templates
INSERT INTO outreach_templates (name, channel, subject, body, variables, sort_order) VALUES
  ('Platform Rebuild Pitch', 'email', 'Quick question about {{business_name}}''s website', E'Hi \u2014 I noticed {{business_name}}''s site is built on {{platform}}. We recently helped a similar {{niche}} business migrate to a custom platform and saw {{metric}}.\n\nWould it be worth a 15-minute call to see if the same approach could work for you?\n\nBest,\nIyad\nTweak & Build', ARRAY['business_name','platform','niche','metric'], 1),
  ('Speed & Performance', 'email', 'Your site loads in {{load_time}}s — we can fix that', E'Hi \u2014 I ran a quick check on {{business_name}}''s website and noticed it takes about {{load_time}} seconds to load. That''s costing you roughly {{lost_percent}}% of visitors who leave before the page finishes.\n\nWe specialize in rebuilding sites for speed. Our last project cut load times by 80%.\n\nWorth a quick chat?\n\nIyad\nTweak & Build', ARRAY['business_name','load_time','lost_percent'], 2),
  ('LinkedIn Introduction', 'linkedin', NULL, E'Hi \u2014 came across {{business_name}} and had a specific idea for how your online presence could drive more {{niche}} customers. Mind if I share it?', ARRAY['business_name','niche'], 3),
  ('Value-Add Follow Up', 'follow_up', 'Re: {{business_name}}''s website', E'Hi \u2014 following up on my note from last week. I put together a quick analysis of {{business_name}}''s site:\n\n\u2022 Performance: {{performance_grade}}\n\u2022 Mobile: {{mobile_status}}\n\u2022 Missing: {{missing_items}}\n\nHappy to walk through it on a call if useful.\n\nIyad', ARRAY['business_name','performance_grade','mobile_status','missing_items'], 4);

-- 6.1 Dedup columns on discovery_results
ALTER TABLE discovery_results ADD COLUMN IF NOT EXISTS estimated_score integer;
ALTER TABLE discovery_results ADD COLUMN IF NOT EXISTS detected_platform text;
ALTER TABLE discovery_results ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false;
ALTER TABLE discovery_results ADD COLUMN IF NOT EXISTS duplicate_lead_id uuid;
