import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one check that stands between "a proposal references a lead" and "an
 * agent attached a proposal to a lead they cannot see".
 *
 * The proposals insert policy only requires `created_by = me`, so nothing in
 * the database stops a caller from posting someone else's `lead_id`. The read
 * below goes through the request-scoped (RLS-bound) client, so a lead the
 * caller is not allowed to see simply is not there — which is exactly the
 * answer we want, without this route having to re-implement the ownership rule.
 */
export async function canAttachLead(
  supabase: SupabaseClient,
  leadId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}
