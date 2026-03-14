import { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, ImportJob, EnrichmentJob, DashboardStats, DiscoveryJob, DiscoveryResult } from "./types";
import type { LeadFilter } from "@/lib/validators/lead";

export async function getLeads(
  supabase: SupabaseClient,
  filters: LeadFilter
): Promise<{ data: Lead[]; count: number }> {
  let query = supabase.from("leads").select("*", { count: "exact" });

  if (filters.search) {
    query = query.or(
      `business_name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,niche.ilike.%${filters.search}%,website.ilike.%${filters.search}%`
    );
  }
  if (filters.lifecycle_status) {
    query = query.eq("lifecycle_status", filters.lifecycle_status);
  }
  if (filters.enrichment_status) {
    query = query.eq("enrichment_status", filters.enrichment_status);
  }
  if (filters.niche) {
    query = query.eq("niche", filters.niche);
  }
  if (filters.min_score !== undefined) {
    query = query.gte("score", filters.min_score);
  }

  const offset = (filters.page - 1) * filters.per_page;
  query = query
    .order(filters.sort_by, { ascending: filters.sort_order === "asc" })
    .range(offset, offset + filters.per_page - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  return { data: (data as Lead[]) ?? [], count: count ?? 0 };
}

export async function getLeadById(
  supabase: SupabaseClient,
  id: string
): Promise<Lead | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data as Lead;
}

export async function getDashboardStats(
  supabase: SupabaseClient
): Promise<DashboardStats> {
  const [totalRes, enrichedRes, contactedRes, failedRes, scoreRes] =
    await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("enrichment_status", "completed"),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("lifecycle_status", "contacted"),
      supabase
        .from("enrichment_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed"),
      supabase.from("leads").select("score"),
    ]);

  const scores = (scoreRes.data as { score: number }[]) ?? [];
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b.score, 0) / scores.length)
      : 0;

  return {
    total_leads: totalRes.count ?? 0,
    enriched_leads: enrichedRes.count ?? 0,
    contacted_leads: contactedRes.count ?? 0,
    failed_jobs: failedRes.count ?? 0,
    average_score: avgScore,
  };
}

export async function getImportJobs(
  supabase: SupabaseClient
): Promise<ImportJob[]> {
  const { data, error } = await supabase
    .from("import_jobs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ImportJob[]) ?? [];
}

export async function getEnrichmentJobs(
  supabase: SupabaseClient
): Promise<EnrichmentJob[]> {
  const { data, error } = await supabase
    .from("enrichment_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as EnrichmentJob[]) ?? [];
}

export async function getDiscoveryJobs(
  supabase: SupabaseClient
): Promise<DiscoveryJob[]> {
  const { data, error } = await supabase
    .from("discovery_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as DiscoveryJob[]) ?? [];
}

export async function getDiscoveryResults(
  supabase: SupabaseClient,
  jobId: string
): Promise<DiscoveryResult[]> {
  const { data, error } = await supabase
    .from("discovery_results")
    .select("*")
    .eq("discovery_job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as DiscoveryResult[]) ?? [];
}

export async function getLatestDiscoveryJob(
  supabase: SupabaseClient
): Promise<DiscoveryJob | null> {
  const { data, error } = await supabase
    .from("discovery_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data as DiscoveryJob;
}

export async function checkDuplicateLead(
  supabase: SupabaseClient,
  businessName: string,
  website: string | undefined
): Promise<boolean> {
  let query = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .ilike("business_name", businessName);

  if (website) {
    query = query.eq("website", website);
  }

  const { count } = await query;
  return (count ?? 0) > 0;
}
