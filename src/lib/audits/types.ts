// ============================================
// Audit Types — Lead Research
// ============================================

export type OpportunityGrade = "A+" | "A" | "B" | "C";

export interface AuditJson {
  overall_score: number;
  seo_score: number;
  speed_score: number;
  mobile_score: number;
  conversion_score: number;
  opportunity_grade: OpportunityGrade;
  missing_pages: string[];
  missing_schema: string[];
  gbp_issues: string[];
  competitor_gaps: string[];
  top_3_recommendations: string[];
  estimated_monthly_leads_lost: number;
  summary: string;
}

export interface LeadAudit {
  id: string;
  url: string;
  audit_json: AuditJson | null;
  opportunity_grade: OpportunityGrade | null;
  overall_score: number | null;
  lead_id: string | null;
  created_at: string;
}

export interface ExtractedSiteData {
  url: string;
  title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  h1_tags: string[];
  canonical: string | null;
  og_title: string | null;
  og_description: string | null;
  json_ld_types: string[];
  has_sitemap: boolean;
  has_robots_txt: boolean;
  has_contact_page: boolean;
  fetch_error: string | null;
}

export interface PageSpeedScores {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  mobile_performance: number | null;
  desktop_performance: number | null;
  error: string | null;
}
