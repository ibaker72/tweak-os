import { SupabaseClient } from "@supabase/supabase-js";
import type {
  Lead,
  EnrichmentResult,
  ScoreResult,
  OutreachData,
  DiscoveryInput,
} from "./types";
import type { DiscoveredBusiness } from "./discovery";
import type { ValidatedCsvRow } from "@/lib/validators/import";

export async function insertLead(
  supabase: SupabaseClient,
  row: ValidatedCsvRow
): Promise<Lead> {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      business_name: row.business_name,
      city: row.city ?? null,
      state: row.state ?? null,
      website: row.website ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      source: row.source ?? null,
      niche: row.niche ?? row.industry ?? null,
      external_id: row.external_id ?? null,
      entity_type: row.entity_type ?? null,
      entity_status: row.entity_status ?? null,
      registered_agent: row.registered_agent ?? null,
      source_filing_date: parseFilingDate(row.source_filing_date),
      import_notes: row.import_notes ?? null,
      lifecycle_status: "new",
      enrichment_status: "pending",
      score: 0,
      reasons: [],
      score_breakdown: {},
      tech_stack: [],
      social_links: {},
    })
    .select()
    .single();
  if (error) throw error;
  return data as Lead;
}

// NJ exports use M/D/YYYY or YYYY-MM-DD. Postgres `date` accepts ISO; coerce
// or fall back to null so the insert doesn't fail on the column.
function parseFilingDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // ISO YYYY-MM-DD or YYYY/MM/DD
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // US M/D/YYYY or MM-DD-YYYY
  const us = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export async function updateLeadEnrichment(
  supabase: SupabaseClient,
  leadId: string,
  enrichment: EnrichmentResult,
  scoring: ScoreResult,
  outreach?: OutreachData | null
): Promise<void> {
  const updateData: Record<string, unknown> = {
    enrichment_status: "complete",
    page_title: enrichment.page_title,
    email_1: enrichment.emails[0] ?? null,
    email_2: enrichment.emails[1] ?? null,
    email: enrichment.emails[0] ?? null,
    phone_1: enrichment.phones[0] ?? null,
    phone_2: enrichment.phones[1] ?? null,
    phone: enrichment.phones[0] ?? null,
    contact_page: enrichment.contact_page,
    facebook: enrichment.facebook,
    instagram: enrichment.instagram,
    linkedin: enrichment.linkedin,
    twitter: enrichment.twitter,
    tech_stack: enrichment.tech_stack,
    has_ssl: enrichment.has_ssl,
    is_mobile_responsive: enrichment.is_mobile_responsive,
    has_blog: enrichment.has_blog,
    has_ecommerce: enrichment.has_ecommerce,
    page_load_time_ms: enrichment.page_load_time_ms,
    social_links: {
      facebook: enrichment.facebook,
      instagram: enrichment.instagram,
      linkedin: enrichment.linkedin,
      twitter: enrichment.twitter,
    },
    score: scoring.score,
    reasons: scoring.reasons,
    score_breakdown: scoring.breakdown,
  };

  if (outreach) {
    updateData.outreach = outreach;
    updateData.pain_point_1 = outreach.pain_points?.[0] ?? null;
    updateData.pain_point_2 = outreach.pain_points?.[1] ?? null;
    updateData.offer_angle = outreach.offer_angle ?? null;
    updateData.suggested_first_line = outreach.cold_email?.split("\n")[0] ?? null;
  }

  const { error } = await supabase
    .from("leads")
    .update(updateData)
    .eq("id", leadId);
  if (error) throw error;
}

export async function updateLeadStatus(
  supabase: SupabaseClient,
  leadId: string,
  lifecycle_status: string
): Promise<void> {
  const updateData: Record<string, unknown> = { lifecycle_status };
  if (lifecycle_status === "contacted") {
    updateData.contacted_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("leads")
    .update(updateData)
    .eq("id", leadId);
  if (error) throw error;
}

export async function updateLeadNotes(
  supabase: SupabaseClient,
  leadId: string,
  manual_notes: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({ manual_notes })
    .eq("id", leadId);
  if (error) throw error;
}

export async function updateLeadOutreach(
  supabase: SupabaseClient,
  leadId: string,
  outreach: OutreachData
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      outreach,
      pain_point_1: outreach.pain_points?.[0] ?? null,
      pain_point_2: outreach.pain_points?.[1] ?? null,
      offer_angle: outreach.offer_angle ?? null,
    })
    .eq("id", leadId);
  if (error) throw error;
}

export async function updateLeadScore(
  supabase: SupabaseClient,
  leadId: string,
  score: number,
  manual_adjustment?: boolean
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({ score })
    .eq("id", leadId);
  if (error) throw error;

  if (manual_adjustment) {
    await logActivity(supabase, leadId, "score_adjusted", {
      new_score: score,
    });
  }
}

export async function markLeadEnrichmentFailed(
  supabase: SupabaseClient,
  leadId: string,
  errorMessage?: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      enrichment_status: "failed",
      enrichment_error: errorMessage || null,
    })
    .eq("id", leadId);
  if (error) throw error;
}

export async function resetLeadForEnrichment(
  supabase: SupabaseClient,
  leadId: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({ enrichment_status: "pending", enrichment_error: null })
    .eq("id", leadId);
  if (error) throw error;
}

export async function deleteLeads(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .delete()
    .in("id", leadIds);
  if (error) throw error;
}

export async function bulkUpdateLeadStatus(
  supabase: SupabaseClient,
  leadIds: string[],
  lifecycle_status: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({ lifecycle_status })
    .in("id", leadIds);
  if (error) throw error;
}

// ============================================
// Import Job Mutations
// ============================================

export async function createImportJob(
  supabase: SupabaseClient,
  filename: string,
  totalRows: number
): Promise<string> {
  const { data, error } = await supabase
    .from("import_jobs")
    .insert({
      filename,
      total_rows: totalRows,
      status: "processing",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateImportJob(
  supabase: SupabaseClient,
  jobId: string,
  updates: {
    imported_rows?: number;
    failed_rows?: number;
    status?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("import_jobs")
    .update(updates)
    .eq("id", jobId);
  if (error) throw error;
}

// ============================================
// Enrichment Job Mutations
// ============================================

export async function createEnrichmentJob(
  supabase: SupabaseClient,
  leadId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("enrichment_jobs")
    .insert({
      lead_id: leadId,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateEnrichmentJob(
  supabase: SupabaseClient,
  jobId: string,
  updates: {
    status?: string;
    error_message?: string;
    started_at?: string;
    completed_at?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("enrichment_jobs")
    .update(updates)
    .eq("id", jobId);
  if (error) throw error;
}

// ============================================
// Discovery Mutations
// ============================================

export async function createDiscoveryJob(
  supabase: SupabaseClient,
  input: DiscoveryInput
): Promise<string> {
  const { data, error } = await supabase
    .from("discovery_jobs")
    .insert({
      niche: input.niche || null,
      city: input.city || null,
      state: input.state || null,
      keyword: input.keyword || null,
      source: input.source,
      status: "processing",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateDiscoveryJob(
  supabase: SupabaseClient,
  jobId: string,
  updates: {
    status?: string;
    total_found?: number;
    imported?: number;
    error_message?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("discovery_jobs")
    .update(updates)
    .eq("id", jobId);
  if (error) throw error;
}

export async function insertDiscoveryResults(
  supabase: SupabaseClient,
  jobId: string,
  results: DiscoveredBusiness[]
): Promise<void> {
  if (results.length === 0) return;

  const rows = results.map((r) => ({
    discovery_job_id: jobId,
    business_name: r.business_name,
    city: r.city,
    state: r.state,
    website: r.website,
    source: r.source,
    niche: r.niche,
    imported: false,
    estimated_score: r.estimated_score ?? null,
    detected_platform: r.detected_platform ?? null,
    is_duplicate: r.is_duplicate ?? false,
    duplicate_lead_id: r.duplicate_lead_id ?? null,
  }));

  const { error } = await supabase.from("discovery_results").insert(rows);
  if (error) throw error;
}

export async function importDiscoveryResults(
  supabase: SupabaseClient,
  resultIds: string[]
): Promise<{ imported: number; skipped: number }> {
  const { data: results, error: fetchError } = await supabase
    .from("discovery_results")
    .select("*")
    .in("id", resultIds)
    .eq("imported", false);
  if (fetchError) throw fetchError;
  if (!results || results.length === 0) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  for (const result of results) {
    // Check duplicate by google_place_id or business name
    if (result.google_place_id) {
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("google_place_id", result.google_place_id);
      if ((count ?? 0) > 0) {
        skipped++;
        continue;
      }
    }

    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("business_name", result.business_name);

    if ((count ?? 0) > 0) {
      skipped++;
      continue;
    }

    const { data: lead, error: insertError } = await supabase
      .from("leads")
      .insert({
        business_name: result.business_name,
        city: result.city,
        state: result.state,
        website: result.website,
        phone: result.phone ?? null,
        source: result.source ?? "discovery",
        niche: result.niche,
        google_place_id: result.google_place_id ?? null,
        google_rating: result.google_rating ?? null,
        google_review_count: result.google_review_count ?? null,
        category: result.category ?? null,
        address: result.address ?? null,
        lifecycle_status: "new",
        enrichment_status: "pending",
        score: 0,
        reasons: [],
        score_breakdown: {},
        tech_stack: [],
        social_links: {},
      })
      .select("id")
      .single();

    if (insertError) {
      skipped++;
      continue;
    }

    await supabase
      .from("discovery_results")
      .update({ imported: true, lead_id: lead.id })
      .eq("id", result.id);

    imported++;
  }

  // Update discovery job imported count
  if (results.length > 0) {
    const jobId = results[0].discovery_job_id;
    const { data: jobData } = await supabase
      .from("discovery_jobs")
      .select("imported")
      .eq("id", jobId)
      .single();
    if (jobData) {
      await supabase
        .from("discovery_jobs")
        .update({ imported: (jobData.imported ?? 0) + imported })
        .eq("id", jobId);
    }
  }

  return { imported, skipped };
}

// ============================================
// Activity Log
// ============================================

export async function logActivity(
  supabase: SupabaseClient,
  leadId: string,
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  await supabase.from("activity_log").insert({
    lead_id: leadId,
    action,
    details: details ?? null,
  });
}

// ============================================
// Saved Search Mutations
// ============================================

export async function createSavedSearch(
  supabase: SupabaseClient,
  data: {
    name: string;
    query: string;
    location?: string;
    radius?: number;
    industry?: string;
    is_recurring?: boolean;
  }
): Promise<string> {
  const { data: result, error } = await supabase
    .from("saved_searches")
    .insert({
      name: data.name,
      query: data.query,
      location: data.location ?? null,
      radius: data.radius ?? null,
      industry: data.industry ?? null,
      is_recurring: data.is_recurring ?? false,
    })
    .select("id")
    .single();
  if (error) throw error;
  return result.id;
}

export async function deleteSavedSearch(
  supabase: SupabaseClient,
  searchId: string
): Promise<void> {
  const { error } = await supabase
    .from("saved_searches")
    .delete()
    .eq("id", searchId);
  if (error) throw error;
}

export async function updateSavedSearchLastRun(
  supabase: SupabaseClient,
  searchId: string
): Promise<void> {
  const { error } = await supabase
    .from("saved_searches")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", searchId);
  if (error) throw error;
}
