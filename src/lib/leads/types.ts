// ============================================
// Lead Types
// ============================================

export type LifecycleStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost"
  | "archived";

export type EnrichmentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface Lead {
  id: string;
  business_name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  source: string | null;
  niche: string | null;
  lifecycle_status: LifecycleStatus;
  enrichment_status: EnrichmentStatus;
  page_title: string | null;
  email_1: string | null;
  email_2: string | null;
  phone_1: string | null;
  phone_2: string | null;
  contact_page: string | null;
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
  score: number;
  reasons: string[];
  pain_point_1: string | null;
  pain_point_2: string | null;
  offer_angle: string | null;
  suggested_first_line: string | null;
  manual_notes: string | null;
  created_at: string;
  updated_at: string;
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
  status: EnrichmentStatus;
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
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export interface InsightResult {
  pain_point_1: string;
  pain_point_2: string;
  offer_angle: string;
  suggested_first_line: string;
}

export interface CsvLeadRow {
  business_name: string;
  city?: string;
  state?: string;
  website?: string;
  source?: string;
  niche?: string;
}

export interface DashboardStats {
  total_leads: number;
  enriched_leads: number;
  contacted_leads: number;
  failed_jobs: number;
  average_score: number;
}

// ============================================
// Discovery Types
// ============================================

export type DiscoverySource = "manual" | "url_list" | "yelp";

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
  source: string | null;
  niche: string | null;
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
  urls?: string; // newline-separated URLs for url_list source
}
