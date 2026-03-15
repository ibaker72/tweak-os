// ============================================
// Lead Types — Upgraded Schema
// ============================================

export type LifecycleStatus =
  | "new"
  | "enriched"
  | "contacted"
  | "replied"
  | "meeting_booked"
  | "won"
  | "lost"
  | "not_a_fit";

export type EnrichmentStatus =
  | "pending"
  | "crawling"
  | "complete"
  | "failed";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface SocialLinks {
  linkedin?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  instagram?: string | null;
}

export interface ScoreBreakdown {
  [factor: string]: number;
}

export interface OutreachData {
  pain_points?: string[];
  offer_angle?: string;
  cold_email?: string;
  linkedin_dm?: string;
  follow_up_email?: string;
  pricing_tier?: string;
}

export interface Lead {
  id: string;
  business_name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  industry: string | null;
  niche: string | null;
  category: string | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  tech_stack: string[];
  has_ssl: boolean | null;
  is_mobile_responsive: boolean | null;
  has_blog: boolean | null;
  has_ecommerce: boolean | null;
  page_load_time_ms: number | null;
  social_links: SocialLinks;
  score: number;
  score_breakdown: ScoreBreakdown;
  lifecycle_status: LifecycleStatus;
  enrichment_status: EnrichmentStatus;
  outreach: OutreachData | null;
  notes: string | null;
  manual_notes: string | null;
  source: string | null;
  enrichment_error: string | null;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;

  // Legacy fields (kept for backward compat during migration)
  page_title: string | null;
  email_1: string | null;
  email_2: string | null;
  phone_1: string | null;
  phone_2: string | null;
  contact_page: string | null;
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
  twitter: string | null;
  reasons: string[];
  pain_point_1: string | null;
  pain_point_2: string | null;
  offer_angle: string | null;
  suggested_first_line: string | null;
}

export interface ImportJob {
  id: string;
  filename: string;
  total_rows: number;
  imported_rows: number;
  failed_rows: number;
  status: JobStatus;
  created_at: string;
}

export interface EnrichmentJob {
  id: string;
  lead_id: string;
  status: EnrichmentStatus | "in_progress" | "pending" | "completed";
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface EnrichmentResult {
  page_title: string | null;
  emails: string[];
  phones: string[];
  contact_page: string | null;
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
  twitter: string | null;
  tech_stack: string[];
  has_ssl: boolean;
  is_mobile_responsive: boolean;
  has_blog: boolean;
  has_ecommerce: boolean;
  page_load_time_ms: number | null;
  last_modified: string | null;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
  breakdown: ScoreBreakdown;
}

export interface InsightResult {
  pain_point_1: string;
  pain_point_2: string;
  offer_angle: string;
  suggested_first_line: string;
}

export interface CsvLeadRow {
  business_name: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  industry?: string;
  niche?: string;
  source?: string;
}

export interface DashboardStats {
  total_leads: number;
  enriched_leads: number;
  contacted_leads: number;
  failed_jobs: number;
  average_score: number;
  leads_by_status: Record<string, number>;
  leads_by_score_tier: { hot: number; warm: number; cold: number };
  leads_this_week: number;
  leads_this_month: number;
  top_industries: { industry: string; count: number }[];
  api_usage: {
    google_places_today: number;
    google_search_today: number;
    openai_this_month: number;
    google_places_cost: number;
  };
}

// ============================================
// Discovery Types
// ============================================

export type DiscoverySource = "manual" | "url_list" | "google_places" | "google_search";

export interface DiscoveryJob {
  id: string;
  niche: string | null;
  city: string | null;
  state: string | null;
  keyword: string | null;
  source: string;
  status: JobStatus;
  total_found: number;
  imported: number;
  error_message: string | null;
  created_at: string;
}

export interface DiscoveryResult {
  id: string;
  discovery_job_id: string;
  business_name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  source: string | null;
  niche: string | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  category: string | null;
  address: string | null;
  imported: boolean;
  lead_id: string | null;
  created_at: string;
}

export interface DiscoveryInput {
  niche: string;
  city: string;
  state: string;
  keyword: string;
  source: DiscoverySource;
  urls?: string;
  radius?: number;
}

// ============================================
// Saved Search Types
// ============================================

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  location: string | null;
  radius: number | null;
  industry: string | null;
  last_run_at: string | null;
  is_recurring: boolean;
  created_at: string;
}

// ============================================
// API Usage Types
// ============================================

export interface ApiUsageRecord {
  id: string;
  service: string;
  endpoint: string | null;
  cost_estimate: number;
  created_at: string;
}

// ============================================
// Activity Log Types
// ============================================

export interface ActivityLogEntry {
  id: string;
  lead_id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}
