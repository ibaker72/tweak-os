import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadAudit, OpportunityGrade } from "./types";

export interface LeadAuditSummary {
  id: string;
  url: string;
  opportunity_grade: OpportunityGrade | null;
  overall_score: number | null;
  created_at: string;
}

/**
 * Fetch the most recent audit per lead for the given lead ids.
 * Returns a map keyed by lead_id.
 */
export async function getLatestAuditsByLeadIds(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<Map<string, LeadAuditSummary>> {
  const map = new Map<string, LeadAuditSummary>();
  if (leadIds.length === 0) return map;

  const { data, error } = await supabase
    .from("lead_audits")
    .select("id, lead_id, url, opportunity_grade, overall_score, created_at")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false });

  if (error) throw error;

  for (const row of (data ?? []) as (LeadAuditSummary & {
    lead_id: string | null;
  })[]) {
    if (!row.lead_id) continue;
    if (!map.has(row.lead_id)) {
      map.set(row.lead_id, {
        id: row.id,
        url: row.url,
        opportunity_grade: row.opportunity_grade,
        overall_score: row.overall_score,
        created_at: row.created_at,
      });
    }
  }

  return map;
}

/**
 * Fetch the most recent audit for a single lead, falling back to a website match
 * when no direct lead_id link exists.
 */
export async function getLatestAuditForLead(
  supabase: SupabaseClient,
  leadId: string,
  website?: string | null
): Promise<LeadAudit | null> {
  const { data: linked, error: linkedErr } = await supabase
    .from("lead_audits")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linkedErr && linkedErr.code !== "PGRST116") throw linkedErr;
  if (linked) return linked as LeadAudit;

  if (website) {
    const { data: byUrl, error: urlErr } = await supabase
      .from("lead_audits")
      .select("*")
      .eq("url", website)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (urlErr && urlErr.code !== "PGRST116") throw urlErr;
    if (byUrl) return byUrl as LeadAudit;
  }

  return null;
}
