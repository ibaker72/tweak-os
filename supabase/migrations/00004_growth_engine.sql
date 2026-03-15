-- TweakAndBuild Lead Finder - Growth Engine Module
-- ==================================================
-- Adds keyword opportunities, content briefs, drafts,
-- performance tracking, content calendar, and expands
-- the activity_log for cross-module use.

-- ============================================
-- ALTER LEADS TABLE
-- ============================================

-- Attribution: which content piece sourced this lead
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_content text;

-- ============================================
-- ALTER ACTIVITY_LOG TABLE
-- ============================================

-- Make lead_id nullable (was NOT NULL implicitly via FK only)
ALTER TABLE activity_log ALTER COLUMN lead_id DROP NOT NULL;

-- Add cross-module columns
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS module text DEFAULT 'leads'
  CHECK (module IN ('leads', 'growth', 'platform'));
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS entity_id uuid;

-- Index for new columns
CREATE INDEX IF NOT EXISTS idx_activity_log_module ON activity_log (module);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log (entity_type, entity_id);

-- ============================================
-- GROWTH OPPORTUNITIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS growth_opportunities (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword          text NOT NULL,
  search_volume    integer,
  difficulty_score integer,
  intent           text CHECK (intent IN ('informational', 'commercial', 'transactional', 'navigational')),
  cluster          text,
  relevance_score  integer DEFAULT 0,
  opportunity_score integer DEFAULT 0,
  status           text NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'planned', 'in_progress', 'published', 'declined')),
  source           text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  user_id          uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_growth_opportunities_status ON growth_opportunities (status);
CREATE INDEX IF NOT EXISTS idx_growth_opportunities_cluster ON growth_opportunities (cluster);
CREATE INDEX IF NOT EXISTS idx_growth_opportunities_opportunity_score ON growth_opportunities (opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_growth_opportunities_keyword ON growth_opportunities (keyword);
CREATE INDEX IF NOT EXISTS idx_growth_opportunities_created_at ON growth_opportunities (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_opportunities_user_id ON growth_opportunities (user_id);

CREATE TRIGGER growth_opportunities_updated_at
  BEFORE UPDATE ON growth_opportunities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- GROWTH BRIEFS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS growth_briefs (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  opportunity_id      uuid REFERENCES growth_opportunities(id) ON DELETE SET NULL,
  title               text NOT NULL,
  target_keyword      text NOT NULL,
  secondary_keywords  text[] DEFAULT '{}',
  target_url          text,
  content_type        text NOT NULL DEFAULT 'blog_post'
    CHECK (content_type IN ('blog_post', 'landing_page', 'case_study', 'comparison', 'guide', 'tool_page')),
  outline             jsonb,
  target_word_count   integer DEFAULT 1500,
  target_audience     text,
  cta_strategy        text,
  internal_links      text[] DEFAULT '{}',
  competitor_urls     text[] DEFAULT '{}',
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'in_progress', 'complete')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  user_id             uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_growth_briefs_opportunity_id ON growth_briefs (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_growth_briefs_status ON growth_briefs (status);
CREATE INDEX IF NOT EXISTS idx_growth_briefs_content_type ON growth_briefs (content_type);
CREATE INDEX IF NOT EXISTS idx_growth_briefs_created_at ON growth_briefs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_briefs_user_id ON growth_briefs (user_id);

CREATE TRIGGER growth_briefs_updated_at
  BEFORE UPDATE ON growth_briefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- GROWTH DRAFTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS growth_drafts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brief_id          uuid REFERENCES growth_briefs(id) ON DELETE SET NULL,
  opportunity_id    uuid REFERENCES growth_opportunities(id) ON DELETE SET NULL,
  title             text NOT NULL,
  slug              text,
  content           text,
  meta_title        text,
  meta_description  text,
  word_count        integer DEFAULT 0,
  seo_score         integer DEFAULT 0,
  seo_feedback      jsonb,
  readability_score integer,
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'scheduled', 'published', 'needs_update')),
  scheduled_for     timestamptz,
  published_at      timestamptz,
  published_url     text,
  version           integer DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  user_id           uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_growth_drafts_brief_id ON growth_drafts (brief_id);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_opportunity_id ON growth_drafts (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_status ON growth_drafts (status);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_slug ON growth_drafts (slug);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_scheduled_for ON growth_drafts (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_published_at ON growth_drafts (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_created_at ON growth_drafts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_user_id ON growth_drafts (user_id);

CREATE TRIGGER growth_drafts_updated_at
  BEFORE UPDATE ON growth_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- GROWTH PERFORMANCE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS growth_performance (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  draft_id         uuid NOT NULL REFERENCES growth_drafts(id) ON DELETE CASCADE,
  date             date NOT NULL,
  impressions      integer DEFAULT 0,
  clicks           integer DEFAULT 0,
  ctr              numeric DEFAULT 0,
  avg_position     numeric DEFAULT 0,
  page_views       integer DEFAULT 0,
  avg_time_on_page integer DEFAULT 0,
  bounce_rate      numeric DEFAULT 0,
  conversions      integer DEFAULT 0,
  top_queries      jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_performance_draft_id ON growth_performance (draft_id);
CREATE INDEX IF NOT EXISTS idx_growth_performance_date ON growth_performance (date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_performance_draft_date ON growth_performance (draft_id, date);

-- ============================================
-- GROWTH CALENDAR TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS growth_calendar (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  draft_id        uuid REFERENCES growth_drafts(id) ON DELETE CASCADE,
  title           text NOT NULL,
  scheduled_date  date NOT NULL,
  content_type    text,
  status          text NOT NULL DEFAULT 'planned',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_growth_calendar_draft_id ON growth_calendar (draft_id);
CREATE INDEX IF NOT EXISTS idx_growth_calendar_scheduled_date ON growth_calendar (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_growth_calendar_status ON growth_calendar (status);
CREATE INDEX IF NOT EXISTS idx_growth_calendar_user_id ON growth_calendar (user_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE growth_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage growth_opportunities"
  ON growth_opportunities FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage growth_briefs"
  ON growth_briefs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage growth_drafts"
  ON growth_drafts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage growth_performance"
  ON growth_performance FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage growth_calendar"
  ON growth_calendar FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
