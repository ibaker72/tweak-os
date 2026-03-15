// Growth Engine Types

export type OpportunityStatus = 'discovered' | 'planned' | 'in_progress' | 'published' | 'declined';
export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational';
export type ContentType = 'blog_post' | 'landing_page' | 'case_study' | 'comparison' | 'guide' | 'tool_page';
export type BriefStatus = 'draft' | 'approved' | 'in_progress' | 'complete';
export type DraftStatus = 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'needs_update';
export type CalendarEntryStatus = 'planned' | 'scheduled' | 'published' | 'cancelled';

export interface GrowthOpportunity {
  id: string;
  keyword: string;
  search_volume: number | null;
  difficulty_score: number | null;
  intent: SearchIntent | null;
  cluster: string | null;
  relevance_score: number;
  opportunity_score: number;
  status: OpportunityStatus;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  user_id: string | null;
}

export interface GrowthBrief {
  id: string;
  opportunity_id: string | null;
  title: string;
  target_keyword: string;
  secondary_keywords: string[];
  target_url: string | null;
  content_type: ContentType;
  outline: BriefOutline | null;
  target_word_count: number;
  target_audience: string | null;
  cta_strategy: string | null;
  internal_links: string[];
  competitor_urls: string[];
  status: BriefStatus;
  created_at: string;
  updated_at: string;
  user_id: string | null;
}

export interface BriefOutline {
  sections: {
    heading: string;
    level: 'h2' | 'h3';
    key_points: string[];
  }[];
}

export interface GrowthDraft {
  id: string;
  brief_id: string | null;
  opportunity_id: string | null;
  title: string;
  slug: string | null;
  content: string | null;
  meta_title: string | null;
  meta_description: string | null;
  word_count: number;
  seo_score: number;
  seo_feedback: SeoFeedback | null;
  readability_score: number | null;
  status: DraftStatus;
  scheduled_for: string | null;
  published_at: string | null;
  published_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  // Joined fields (optional)
  brief?: GrowthBrief;
  opportunity?: GrowthOpportunity;
}

export interface SeoFeedback {
  issues: string[];
  suggestions: string[];
}

export interface GrowthPerformance {
  id: string;
  draft_id: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number;
  page_views: number;
  avg_time_on_page: number;
  bounce_rate: number;
  conversions: number;
  top_queries: string[] | null;
  created_at: string;
}

export interface GrowthCalendarEntry {
  id: string;
  draft_id: string | null;
  title: string;
  scheduled_date: string;
  content_type: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  user_id: string | null;
  // Joined
  draft?: GrowthDraft;
}

// Dashboard stats
export interface GrowthDashboardStats {
  total_published: number;
  total_impressions: number;
  total_clicks: number;
  avg_position: number;
  pipeline_count: number;
  conversion_count: number;
}

// AI generation types
export interface KeywordOpportunityResult {
  keyword: string;
  search_demand: 'low' | 'medium' | 'high';
  intent: SearchIntent;
  difficulty: 'easy' | 'medium' | 'hard';
  relevance_score: number;
}

export interface GeneratedBrief {
  title_options: string[];
  target_url: string;
  outline: BriefOutline;
  target_word_count: number;
  internal_links: string[];
  cta_strategy: string;
  competitor_angle: string;
}
