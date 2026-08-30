import type { ValidatedCsvRow } from "@/lib/validators/import";

/**
 * The only fields an agent's CSV row is allowed to contribute.
 *
 * Ownership and credit are deliberately absent. `assigned_to`, `agent_id`,
 * `source` and anything rate-shaped are decided server-side by
 * public.import_agent_leads() from the caller's JWT — a self-sourced lead an
 * agent could address to a teammate is a commission dispute waiting to happen.
 *
 * This type is the client-side half of that guarantee; the database function
 * reads only these keys out of the payload, so a hand-crafted request that
 * added more would still change nothing.
 */
export interface AgentImportRow {
  business_name: string;
  city?: string;
  state?: string;
  address?: string;
  zip?: string;
  website?: string;
  email?: string;
  phone?: string;
  contact_name?: string;
  notes?: string;
  niche?: string;
  external_id?: string;
}

/** Keys the import path must never carry, whatever a CSV or caller supplies. */
export const FORBIDDEN_IMPORT_KEYS = [
  "assigned_to",
  "assigned_at",
  "agent_id",
  "source",
  "rate",
  "rate_bps",
  "commission_rate_bps",
  "attribution",
  "is_override",
  "created_by",
] as const;

/**
 * Project a parsed CSV row onto the import payload.
 *
 * Built by naming each field rather than by spreading the row and deleting
 * what should not be there: a field added to the CSV schema later cannot leak
 * through a whitelist, but it would sail straight through a blacklist.
 */
export function toAgentImportRow(row: ValidatedCsvRow): AgentImportRow {
  const out: AgentImportRow = { business_name: row.business_name };

  const set = (key: keyof AgentImportRow, value: string | undefined) => {
    if (value && value.trim()) out[key] = value.trim();
  };

  set("city", row.city);
  set("state", row.state);
  set("address", row.address);
  set("zip", row.zip);
  set("website", row.website);
  set("email", row.email);
  set("phone", row.phone);
  set("contact_name", row.contact_name);
  set("notes", row.notes);
  // The importer stores one niche; `industry` is the older header for it.
  set("niche", row.niche ?? row.industry);
  set("external_id", row.external_id);

  return out;
}

export function toAgentImportRows(rows: ValidatedCsvRow[]): AgentImportRow[] {
  return rows.map(toAgentImportRow);
}
