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
      address: row.address ?? null,
      zip: row.zip ?? null,
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
  outreach?: OutreachData | null,
  extra?: {
    contact_status?: string | null;
    online_presence?: string | null;
    enrichment_summary?: string | null;
    niche?: string | null;
  }
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

  if (extra?.contact_status !== undefined) updateData.contact_status = extra.contact_status;
  if (extra?.online_presence !== undefined) updateData.online_presence = extra.online_presence;
  if (extra?.enrichment_summary !== undefined) updateData.enrichment_summary = extra.enrichment_summary;
  // Only write niche when an industry guess was provided — never null out
  // an existing niche that came from discovery or manual entry.
  if (extra?.niche) updateData.niche = extra.niche;

  const { error } = await supabase
    .from("leads")
    .update(updateData)
    .eq("id", leadId);
  if (error) throw error;
}

// Lighter update for leads enriched without a website (NJ startup path).
// We do not have website-driven signals to write — just score, outreach,
// and the new contact/presence/summary fields.
export async function updateLeadEnrichmentLite(
  supabase: SupabaseClient,
  leadId: string,
  scoring: ScoreResult,
  outreach: OutreachData | null,
  extra: {
    contact_status: string;
    online_presence: string;
    enrichment_summary: string;
    niche?: string | null;
    phone?: string | null;
    address?: string | null;
    google_rating?: number | null;
    google_review_count?: number | null;
    google_place_id?: string | null;
  }
): Promise<void> {
  const updateData: Record<string, unknown> = {
    enrichment_status: "complete",
    enrichment_error: null,
    score: scoring.score,
    reasons: scoring.reasons,
    score_breakdown: scoring.breakdown,
    contact_status: extra.contact_status,
    online_presence: extra.online_presence,
    enrichment_summary: extra.enrichment_summary,
  };
  if (extra.niche) updateData.niche = extra.niche;
  if (extra.phone !== undefined && extra.phone !== null) {
    updateData.phone = extra.phone;
    updateData.phone_1 = extra.phone;
  }
  if (extra.address !== undefined && extra.address !== null) updateData.address = extra.address;
  if (extra.google_rating !== undefined) updateData.google_rating = extra.google_rating;
  if (extra.google_review_count !== undefined) updateData.google_review_count = extra.google_review_count;
  if (extra.google_place_id !== undefined) updateData.google_place_id = extra.google_place_id;

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
// Lead Management States (archive / soft-delete / restore / contacted)
// ============================================

const STATE_STATUSES = new Set(["archived", "deleted"]);

// Capture the lead's previous status so restore can put it back where it was.
async function snapshotPreviousStatuses(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<Map<string, string | null>> {
  if (leadIds.length === 0) return new Map();
  const { data } = await supabase
    .from("leads")
    .select("id, lifecycle_status, previous_status")
    .in("id", leadIds);

  const map = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{
    id: string;
    lifecycle_status: string;
    previous_status: string | null;
  }>) {
    // If the lead is already in a state status, preserve the earlier previous_status.
    const current = STATE_STATUSES.has(row.lifecycle_status)
      ? row.previous_status
      : row.lifecycle_status;
    map.set(row.id, current);
  }
  return map;
}

export async function archiveLead(
  supabase: SupabaseClient,
  leadId: string
): Promise<void> {
  await bulkArchiveLeads(supabase, [leadId]);
}

export async function bulkArchiveLeads(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<void> {
  if (leadIds.length === 0) return;
  const previous = await snapshotPreviousStatuses(supabase, leadIds);
  const now = new Date().toISOString();

  // Group by previous_status so we can write the right snapshot per lead.
  // In practice most batches share a status, but we update one-by-one in a
  // transaction-free path when statuses diverge.
  const byPrev = new Map<string | null, string[]>();
  for (const id of leadIds) {
    const prev = previous.get(id) ?? null;
    const arr = byPrev.get(prev);
    if (arr) arr.push(id);
    else byPrev.set(prev, [id]);
  }

  for (const [prev, ids] of byPrev) {
    const { error } = await supabase
      .from("leads")
      .update({
        lifecycle_status: "archived",
        archived_at: now,
        deleted_at: null,
        previous_status: prev,
      })
      .in("id", ids);
    if (error) throw error;
  }
}

export async function softDeleteLead(
  supabase: SupabaseClient,
  leadId: string
): Promise<void> {
  await bulkSoftDeleteLeads(supabase, [leadId]);
}

export async function bulkSoftDeleteLeads(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<void> {
  if (leadIds.length === 0) return;
  const previous = await snapshotPreviousStatuses(supabase, leadIds);
  const now = new Date().toISOString();

  const byPrev = new Map<string | null, string[]>();
  for (const id of leadIds) {
    const prev = previous.get(id) ?? null;
    const arr = byPrev.get(prev);
    if (arr) arr.push(id);
    else byPrev.set(prev, [id]);
  }

  for (const [prev, ids] of byPrev) {
    const { error } = await supabase
      .from("leads")
      .update({
        lifecycle_status: "deleted",
        deleted_at: now,
        previous_status: prev,
      })
      .in("id", ids);
    if (error) throw error;
  }
}

// Restore from archived/deleted — falls back to "new" if there's no snapshot.
export async function restoreLead(
  supabase: SupabaseClient,
  leadId: string
): Promise<void> {
  await bulkRestoreLeads(supabase, [leadId]);
}

export async function bulkRestoreLeads(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<void> {
  if (leadIds.length === 0) return;

  const { data } = await supabase
    .from("leads")
    .select("id, previous_status")
    .in("id", leadIds);

  const byTarget = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{
    id: string;
    previous_status: string | null;
  }>) {
    const target =
      row.previous_status && !STATE_STATUSES.has(row.previous_status)
        ? row.previous_status
        : "new";
    const arr = byTarget.get(target);
    if (arr) arr.push(row.id);
    else byTarget.set(target, [row.id]);
  }

  for (const [target, ids] of byTarget) {
    const { error } = await supabase
      .from("leads")
      .update({
        lifecycle_status: target,
        archived_at: null,
        deleted_at: null,
        previous_status: null,
      })
      .in("id", ids);
    if (error) throw error;
  }
}

export async function markLeadContacted(
  supabase: SupabaseClient,
  leadId: string
): Promise<void> {
  await bulkMarkContacted(supabase, [leadId]);
}

export async function bulkMarkContacted(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<void> {
  if (leadIds.length === 0) return;
  const { error } = await supabase
    .from("leads")
    .update({
      lifecycle_status: "contacted",
      contacted_at: new Date().toISOString(),
    })
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
    skipped_rows?: number;
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
