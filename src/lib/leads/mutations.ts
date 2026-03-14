import { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, EnrichmentResult, ScoreResult, InsightResult } from "./types";
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
