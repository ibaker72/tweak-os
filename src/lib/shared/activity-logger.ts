import { SupabaseClient } from "@supabase/supabase-js";
import type { Module } from "@/types/shared";

export async function logActivity(
  supabase: SupabaseClient,
  params: {
    module: Module;
    action: string;
    entity_type?: string;
    entity_id?: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    module: params.module,
    action: params.action,
    entity_type: params.entity_type ?? null,
    entity_id: params.entity_id ?? null,
    details: params.details ?? null,
  });
  if (error) {
    console.error("Failed to log activity:", error);
  }
}

export async function getRecentActivity(
  supabase: SupabaseClient,
  options?: { module?: Module; limit?: number }
): Promise<
  {
    id: string;
    module: string;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
  }[]
> {
  let query = supabase
    .from("activity_log")
    .select("id, module, action, entity_type, entity_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 10);

  if (options?.module) {
    query = query.eq("module", options.module);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to fetch activity:", error);
    return [];
  }
  return data ?? [];
}
