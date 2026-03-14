import { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, EnrichmentResult, ScoreResult, InsightResult, DiscoveryInput } from "./types";
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
      source: row.source ?? null,
      niche: row.niche ?? null,
      lifecycle_status: "new",
      enrichment_status: "pending",
      score: 0,
      reasons: [],
    })
    .select()
    .single();
  if (error) throw error;
  return data as Lead;
}

export async function updateLeadEnrichment(
  supabase: SupabaseClient,
  leadId: string,
  enrichment: EnrichmentResult,
  scoring: ScoreResult,
  insights: InsightResult
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      enrichment_status: "completed",
      page_title: enrichment.page_title,
      email_1: enrichment.emails[0] ?? null,
      email_2: enrichment.emails[1] ?? null,
      phone_1: enrichment.phones[0] ?? null,
      phone_2: enrichment.phones[1] ?? null,
      contact_page: enrichment.contact_page,
      facebook: enrichment.facebook,
      instagram: enrichment.instagram,
      linkedin: enrichment.linkedin,
      score: scoring.score,
      reasons: scoring.reasons,
      pain_point_1: insights.pain_point_1,
      pain_point_2: insights.pain_point_2,
      offer_angle: insights.offer_angle,
      suggested_first_line: insights.suggested_first_line,
    })
    .eq("id", leadId);
  if (error) throw error;
}

export async function updateLeadStatus(
  supabase: SupabaseClient,
  leadId: string,
  lifecycle_status: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({ lifecycle_status })
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

export async function markLeadEnrichmentFailed(
  supabase: SupabaseClient,
  leadId: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({ enrichment_status: "failed" })
    .eq("id", leadId);
  if (error) throw error;
}

export async function resetLeadForEnrichment(
  supabase: SupabaseClient,
  leadId: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({ enrichment_status: "pending" })
    .eq("id", leadId);
  if (error) throw error;
}

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
  }));

  const { error } = await supabase.from("discovery_results").insert(rows);
  if (error) throw error;
}

export async function importDiscoveryResults(
  supabase: SupabaseClient,
  resultIds: string[]
): Promise<{ imported: number; skipped: number }> {
  // Fetch the selected results
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
    // Check duplicate in leads table
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("business_name", result.business_name);

    if ((count ?? 0) > 0) {
      skipped++;
      continue;
    }

    // Insert into leads using existing pattern
    const { data: lead, error: insertError } = await supabase
      .from("leads")
      .insert({
        business_name: result.business_name,
        city: result.city,
        state: result.state,
        website: result.website,
        source: result.source ?? "discovery",
        niche: result.niche,
        lifecycle_status: "new",
        enrichment_status: "pending",
        score: 0,
        reasons: [],
      })
      .select("id")
      .single();

    if (insertError) {
      skipped++;
      continue;
    }

    // Mark discovery result as imported
    await supabase
      .from("discovery_results")
      .update({ imported: true, lead_id: lead.id })
      .eq("id", result.id);

    imported++;
  }

  // Update the discovery job imported count
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
