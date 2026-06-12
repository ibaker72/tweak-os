import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, SmsMessage } from "@/lib/leads/types";
import { normalizePhoneNumber } from "./config";

export async function getSmsMessagesForLead(
  supabase: SupabaseClient,
  leadId: string,
  limit = 50
): Promise<SmsMessage[]> {
  const { data, error } = await supabase
    .from("sms_messages")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as SmsMessage[]) ?? [];
}

/**
 * Find a lead whose phone number matches the inbound From number. We try
 * exact match on the normalized form first, then a digits-only contains
 * fallback for legacy phone numbers stored without country code.
 */
export async function findLeadByPhone(
  supabase: SupabaseClient,
  rawPhone: string
): Promise<Lead | null> {
  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized) return null;

  const tryColumn = async (column: string, value: string) => {
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq(column, value)
      .limit(1);
    return (data as Lead[])?.[0] ?? null;
  };

  // Try exact match on normalized number against all phone columns.
  for (const column of ["phone", "phone_1", "phone_2"]) {
    const lead = await tryColumn(column, normalized);
    if (lead) return lead;
  }

  // Fallback — strip everything except digits and search for the suffix.
  // Useful when leads were imported with formats like "(862) 298-4988".
  const digits = normalized.replace(/\D/g, "");
  if (digits.length >= 10) {
    const suffix = digits.slice(-10);
    const { data } = await supabase
      .from("leads")
      .select("*")
      .or(
        `phone.ilike.%${suffix}%,phone_1.ilike.%${suffix}%,phone_2.ilike.%${suffix}%`
      )
      .limit(1);
    return (data as Lead[])?.[0] ?? null;
  }
  return null;
}
