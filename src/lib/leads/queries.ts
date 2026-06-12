import { SupabaseClient } from "@supabase/supabase-js";
import type {
  Lead,
  ImportJob,
  EnrichmentJob,
  DashboardStats,
  DiscoveryJob,
  DiscoveryResult,
  SavedSearch,
  ActivityLogEntry,
} from "./types";
import type { LeadFilter } from "@/lib/validators/lead";
import { getApiUsageStats } from "./api-usage";

export async function getLeads(
  supabase: SupabaseClient,
  filters: LeadFilter
): Promise<{ data: Lead[]; count: number }> {
  let query = supabase.from("leads").select("*", { count: "exact" });

  // View scoping — archived/deleted are hidden by default. An explicit
  // lifecycle_status filter overrides the view scope.
  if (!filters.lifecycle_status) {
    if (filters.view === "archived") {
      query = query
        .not("archived_at", "is", null)
        .is("deleted_at", null);
    } else if (filters.view === "deleted") {
      query = query.not("deleted_at", "is", null);
    } else if (filters.view === "active") {
      query = query
        .is("archived_at", null)
        .is("deleted_at", null)
        .not("lifecycle_status", "in", "(archived,deleted)");
    }
    // view === "all" applies no archive/delete filter.
  }

  if (filters.search) {
    query = query.or(
      `business_name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,niche.ilike.%${filters.search}%,website.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    );
  }
  if (filters.lifecycle_status) {
    query = query.eq("lifecycle_status", filters.lifecycle_status);
  }
  if (filters.enrichment_status) {
    query = query.eq("enrichment_status", filters.enrichment_status);
  }
  if (filters.niche) {
    query = query.ilike("niche", `%${filters.niche}%`);
  }
  if (filters.industry) {
    query = query.ilike("niche", `%${filters.industry}%`);
  }
  if (filters.city) {
    query = query.ilike("city", `%${filters.city}%`);
  }
  if (filters.state) {
    query = query.ilike("state", `%${filters.state}%`);
  }
  if (filters.min_score !== undefined) {
    query = query.gte("score", filters.min_score);
  }
  if (filters.max_score !== undefined) {
    query = query.lte("score", filters.max_score);
  }
  if (filters.tech_stack) {
    query = query.contains("tech_stack", [filters.tech_stack]);
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
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const [
    totalRes,
    enrichedRes,
    contactedRes,
    repliedRes,
    bookedRes,
    failedRes,
    scoreRes,
    weekRes,
    monthRes,
    statusRes,
    nicheRes,
    recentLeadsRes,
  ] = await Promise.all([
    supabase.from("leads").select("*", { count: "exact", head: true }),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("enrichment_status", "complete"),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("lifecycle_status", "contacted"),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("lifecycle_status", "replied"),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("lifecycle_status", "meeting_booked"),
    supabase
      .from("enrichment_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase.from("leads").select("score"),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .gte("created_at", weekAgo.toISOString()),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .gte("created_at", monthAgo.toISOString()),
    supabase.from("leads").select("lifecycle_status"),
    supabase.from("leads").select("niche").not("niche", "is", null),
    supabase
      .from("leads")
      .select("id, business_name, score, city, state")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const scores = (scoreRes.data as { score: number }[]) ?? [];
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b.score, 0) / scores.length)
      : 0;

  // Count leads by status
  const statusCounts: Record<string, number> = {};
  for (const row of (statusRes.data ?? []) as { lifecycle_status: string }[]) {
    statusCounts[row.lifecycle_status] = (statusCounts[row.lifecycle_status] || 0) + 1;
  }

  // Count leads by score tier
  let hot = 0;
  let warm = 0;
  let cold = 0;
  for (const row of scores) {
    if (row.score >= 70) hot++;
    else if (row.score >= 40) warm++;
    else cold++;
  }

  // Top industries
  const nicheCounts: Record<string, number> = {};
  for (const row of (nicheRes.data ?? []) as { niche: string }[]) {
    if (row.niche) {
      nicheCounts[row.niche] = (nicheCounts[row.niche] || 0) + 1;
    }
  }
  const topIndustries = Object.entries(nicheCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([industry, count]) => ({ industry, count }));

  // API usage
  let apiUsage;
  try {
    apiUsage = await getApiUsageStats(supabase);
  } catch {
    apiUsage = {
      google_places_today: 0,
      google_search_today: 0,
      ai_calls_this_month: 0,
      google_places_cost: 0,
    };
  }

  const recentLeads = ((recentLeadsRes.data ?? []) as { id: string; business_name: string; score: number; city: string | null; state: string | null }[]);

  return {
    total_leads: totalRes.count ?? 0,
    enriched_leads: enrichedRes.count ?? 0,
    contacted_leads: contactedRes.count ?? 0,
    replied_leads: repliedRes.count ?? 0,
    booked_leads: bookedRes.count ?? 0,
    failed_jobs: failedRes.count ?? 0,
    average_score: avgScore,
    leads_by_status: statusCounts,
    leads_by_score_tier: { hot, warm, cold },
    leads_this_week: weekRes.count ?? 0,
    leads_this_month: monthRes.count ?? 0,
    top_industries: topIndustries,
    recent_leads: recentLeads,
    api_usage: apiUsage,
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

// Stronger duplicate check for state-registry imports:
// matches on external_id first (most reliable), then business_name + state.
export async function findDuplicateLeadForImport(
  supabase: SupabaseClient,
  args: {
    business_name: string;
    state: string | undefined;
    external_id: string | undefined;
  }
): Promise<{ duplicate: true; matchedBy: "external_id" | "name_state" } | { duplicate: false }> {
  if (args.external_id) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("external_id", args.external_id);
    if ((count ?? 0) > 0) return { duplicate: true, matchedBy: "external_id" };
  }

  let nameQuery = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .ilike("business_name", args.business_name);
  if (args.state) {
    nameQuery = nameQuery.ilike("state", args.state);
  }
  const { count } = await nameQuery;
  if ((count ?? 0) > 0) return { duplicate: true, matchedBy: "name_state" };

  return { duplicate: false };
}

export async function getSavedSearches(
  supabase: SupabaseClient
): Promise<SavedSearch[]> {
  const { data, error } = await supabase
    .from("saved_searches")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as SavedSearch[]) ?? [];
}

export async function getActivityLog(
  supabase: SupabaseClient,
  leadId: string
): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as ActivityLogEntry[]) ?? [];
}
