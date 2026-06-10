import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append an OpenClaw action to the lead's activity log. Fire-and-forget —
 * logging failures must never break the API response.
 */
export async function logOpenClawAction(
  supabase: SupabaseClient,
  leadId: string,
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      lead_id: leadId,
      action: `openclaw:${action}`,
      details: details ?? null,
    });
  } catch (err) {
    console.error("[openclaw] activity log write failed:", err);
  }
}
