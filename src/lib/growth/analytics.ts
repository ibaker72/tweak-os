import { SupabaseClient } from "@supabase/supabase-js";
import type { GrowthPerformance, GrowthDashboardStats } from "@/types/growth";

export async function getGrowthDashboardStats(
  supabase: SupabaseClient
): Promise<GrowthDashboardStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStr = monthStart.toISOString();

  const [publishedRes, performanceRes, pipelineRes] = await Promise.all([
    supabase
      .from("growth_drafts")
      .select("id", { count: "exact", head: true })
      .eq("status", "published"),
    supabase
      .from("growth_performance")
      .select("impressions, clicks, avg_position, conversions")
      .gte("date", monthStr.split("T")[0]),
    supabase
      .from("growth_drafts")
      .select("id", { count: "exact", head: true })
      .in("status", ["draft", "review", "approved", "scheduled"]),
  ]);

  const perfData = (performanceRes.data ?? []) as {
    impressions: number;
    clicks: number;
    avg_position: number;
    conversions: number;
  }[];

  const totalImpressions = perfData.reduce((sum, r) => sum + (r.impressions || 0), 0);
  const totalClicks = perfData.reduce((sum, r) => sum + (r.clicks || 0), 0);
  const totalConversions = perfData.reduce((sum, r) => sum + (r.conversions || 0), 0);
  const avgPosition =
    perfData.length > 0
      ? Math.round(
          (perfData.reduce((sum, r) => sum + (r.avg_position || 0), 0) / perfData.length) * 10
        ) / 10
      : 0;

  return {
    total_published: publishedRes.count ?? 0,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    avg_position: avgPosition,
    pipeline_count: pipelineRes.count ?? 0,
    conversion_count: totalConversions,
  };
}

export async function getPerformanceByDraft(
  supabase: SupabaseClient,
  draftId: string
): Promise<GrowthPerformance[]> {
  const { data, error } = await supabase
    .from("growth_performance")
    .select("*")
    .eq("draft_id", draftId)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as GrowthPerformance[];
}

export async function getAllPerformance(
  supabase: SupabaseClient
): Promise<(GrowthPerformance & { draft_title?: string })[]> {
  const { data, error } = await supabase
    .from("growth_performance")
    .select("*, growth_drafts(title)")
    .order("date", { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as unknown as GrowthPerformance),
    draft_title: (row.growth_drafts as { title?: string } | null)?.title,
  }));
}

export async function upsertPerformance(
  supabase: SupabaseClient,
  data: {
    draft_id: string;
    date: string;
    impressions?: number;
    clicks?: number;
    ctr?: number;
    avg_position?: number;
    page_views?: number;
    avg_time_on_page?: number;
    bounce_rate?: number;
    conversions?: number;
    top_queries?: string[];
  }
): Promise<void> {
  // Check if entry exists for this draft+date
  const { data: existing } = await supabase
    .from("growth_performance")
    .select("id")
    .eq("draft_id", data.draft_id)
    .eq("date", data.date)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("growth_performance")
      .update({
        impressions: data.impressions,
        clicks: data.clicks,
        ctr: data.ctr,
        avg_position: data.avg_position,
        page_views: data.page_views,
        avg_time_on_page: data.avg_time_on_page,
        bounce_rate: data.bounce_rate,
        conversions: data.conversions,
        top_queries: data.top_queries,
      })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("growth_performance").insert(data);
    if (error) throw error;
  }
}

// TODO: Replace manual entry with GSC API — needs OAuth setup
export async function getContentNeedingAttention(
  supabase: SupabaseClient
): Promise<{
  declining: { draft_id: string; title: string; trend: string }[];
  stale: { id: string; title: string; days_stale: number }[];
  overdue: { id: string; title: string; scheduled_for: string }[];
}> {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Stale drafts: in draft/review status, not updated in 7+ days
  const { data: staleDrafts } = await supabase
    .from("growth_drafts")
    .select("id, title, updated_at")
    .in("status", ["draft", "review"])
    .lt("updated_at", sevenDaysAgo.toISOString());

  // Overdue: scheduled but not published, past schedule date
  const { data: overdueDrafts } = await supabase
    .from("growth_drafts")
    .select("id, title, scheduled_for")
    .eq("status", "scheduled")
    .lt("scheduled_for", now.toISOString());

  const stale = (staleDrafts ?? []).map((d: { id: string; title: string; updated_at: string }) => ({
    id: d.id,
    title: d.title,
    days_stale: Math.floor((now.getTime() - new Date(d.updated_at).getTime()) / (1000 * 60 * 60 * 24)),
  }));

  const overdue = (overdueDrafts ?? []).map((d: { id: string; title: string; scheduled_for: string }) => ({
    id: d.id,
    title: d.title,
    scheduled_for: d.scheduled_for,
  }));

  return { declining: [], stale, overdue };
}
