import type { SupabaseClient } from "@supabase/supabase-js";
import type { VoiceCall } from "@/lib/leads/types";

/**
 * Recent calls on a lead. Unscoped on purpose — no `agent_id = me` filter —
 * because voice_calls RLS already answers that question, and a WHERE clause
 * that duplicates a policy is a WHERE clause that can drift from it.
 */
export async function getVoiceCallsForLead(
  supabase: SupabaseClient,
  leadId: string,
  limit = 10
): Promise<VoiceCall[]> {
  const { data, error } = await supabase
    .from("voice_calls")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as VoiceCall[]) ?? [];
}
