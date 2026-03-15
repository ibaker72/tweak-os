import { SupabaseClient } from "@supabase/supabase-js";

export type ApiService = "google_places" | "google_search" | "openai";

// Cost estimates per call
const COST_PER_CALL: Record<string, number> = {
  "google_places:textsearch": 0.032,
  "google_places:details": 0.017,
  "google_places:nearbysearch": 0.032,
  "google_search:search": 0.005,
  "openai:gpt-4o-mini": 0.0003, // rough per-request estimate
};

export async function trackApiUsage(
  supabase: SupabaseClient,
  service: ApiService,
  endpoint: string
): Promise<void> {
  const costKey = `${service}:${endpoint}`;
  const cost = COST_PER_CALL[costKey] ?? 0;

  await supabase.from("api_usage").insert({
    service,
    endpoint,
    cost_estimate: cost,
  });
}

export async function getApiUsageStats(
  supabase: SupabaseClient
): Promise<{
  google_places_today: number;
  google_search_today: number;
  openai_this_month: number;
  google_places_cost: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStr = monthStart.toISOString();

  const [placesToday, searchToday, openaiMonth, placesCost] = await Promise.all([
    supabase
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("service", "google_places")
      .gte("created_at", todayStr),
    supabase
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("service", "google_search")
      .gte("created_at", todayStr),
    supabase
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("service", "openai")
      .gte("created_at", monthStr),
    supabase
      .from("api_usage")
      .select("cost_estimate")
      .eq("service", "google_places")
      .gte("created_at", monthStr),
  ]);

  const totalPlacesCost = (placesCost.data ?? []).reduce(
    (sum: number, r: { cost_estimate: number }) => sum + (r.cost_estimate || 0),
    0
  );

  return {
    google_places_today: placesToday.count ?? 0,
    google_search_today: searchToday.count ?? 0,
    openai_this_month: openaiMonth.count ?? 0,
    google_places_cost: Math.round(totalPlacesCost * 100) / 100,
  };
}
