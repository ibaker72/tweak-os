import { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "./types";

export interface SmartListFilters {
  lifecycle_status?: string;
  enrichment_status?: string;
  min_score?: number;
  max_score?: number;
  assigned_to?: string;
  priority?: string;
  has_next_action?: boolean;
  next_action_overdue?: boolean;
  niche?: string;
  city?: string;
  state?: string;
  tech_stack_contains?: string;
  days_since_contact?: number;
  source?: string;
}

export async function executeSmartList(
  supabase: SupabaseClient,
  filters: SmartListFilters,
  sortBy: string = "score",
  sortOrder: string = "desc"
): Promise<{ data: Lead[]; count: number }> {
  let query = supabase.from("leads").select("*", { count: "exact" });

  if (filters.lifecycle_status) {
    query = query.eq("lifecycle_status", filters.lifecycle_status);
  }
  if (filters.enrichment_status) {
    query = query.eq("enrichment_status", filters.enrichment_status);
  }
  if (filters.min_score !== undefined) {
    query = query.gte("score", filters.min_score);
  }
  if (filters.max_score !== undefined) {
    query = query.lte("score", filters.max_score);
  }
  if (filters.assigned_to) {
    query = query.eq("assigned_to", filters.assigned_to);
  }
  if (filters.priority) {
    query = query.eq("priority", filters.priority);
  }
  if (filters.has_next_action) {
    query = query.not("next_action", "is", null);
  }
  if (filters.next_action_overdue) {
    query = query.lt("next_action_date", new Date().toISOString().split("T")[0]);
  }
  if (filters.niche) {
    query = query.ilike("niche", `%${filters.niche}%`);
  }
  if (filters.city) {
    query = query.ilike("city", `%${filters.city}%`);
  }
  if (filters.state) {
    query = query.ilike("state", `%${filters.state}%`);
  }
  if (filters.tech_stack_contains) {
    query = query.contains("tech_stack", [filters.tech_stack_contains]);
  }
  if (filters.days_since_contact !== undefined) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.days_since_contact);
    query = query.lt("contacted_at", cutoff.toISOString());
  }
  if (filters.source) {
    query = query.eq("source", filters.source);
  }

  query = query
    .order(sortBy, { ascending: sortOrder === "asc" })
    .limit(100);

  const { data, count, error } = await query;
  if (error) throw error;

  return { data: (data as Lead[]) ?? [], count: count ?? 0 };
}

export interface DefaultSmartList {
  name: string;
  icon: string;
  description: string;
  filters: SmartListFilters;
  sort_by: string;
  sort_order: string;
}

export function getDefaultSmartLists(): DefaultSmartList[] {
  return [
    {
      name: "Hot Leads",
      icon: "flame",
      description: "Score >= 70, not yet contacted",
      filters: { min_score: 70, lifecycle_status: "new" },
      sort_by: "score",
      sort_order: "desc",
    },
    {
      name: "Follow Up Today",
      icon: "phone",
      description: "Leads with next action date of today",
      filters: { has_next_action: true },
      sort_by: "next_action_date",
      sort_order: "asc",
    },
    {
      name: "Overdue Follow-ups",
      icon: "clock",
      description: "Contacted 3+ days ago with no reply",
      filters: { lifecycle_status: "contacted", days_since_contact: 3 },
      sort_by: "contacted_at",
      sort_order: "asc",
    },
    {
      name: "Fresh Imports",
      icon: "sparkles",
      description: "Created in last 7 days, enrichment pending",
      filters: { enrichment_status: "pending" },
      sort_by: "created_at",
      sort_order: "desc",
    },
    {
      name: "Ready to Close",
      icon: "target",
      description: "Replied or meeting booked status",
      filters: { lifecycle_status: "replied" },
      sort_by: "score",
      sort_order: "desc",
    },
  ];
}
