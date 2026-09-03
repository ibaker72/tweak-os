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

/**
 * The fields a bulk (admin) CSV row may contribute.
 *
 * Wider than AgentImportRow because the admin importer carries the NJ Business
 * Records columns and honours the file's own `source` label. Still a
 * whitelist, and still silent on ownership: public.import_bulk_leads() assigns
 * nobody and writes no attribution, so a bulk upload cannot credit whoever ran
 * it.
 */
export interface BulkImportRow extends AgentImportRow {
  source?: string;
  entity_type?: string;
  entity_status?: string;
  registered_agent?: string;
  source_filing_date?: string;
  import_notes?: string;
}

/**
 * NJ exports use M/D/YYYY or YYYY-MM-DD; Postgres wants ISO.
 *
 * Coerced here rather than in SQL so an unparseable date becomes an absent
 * field instead of a failed row — the rest of the record is still worth
 * importing.
 */
export function parseFilingDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const us = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

export function toBulkImportRow(row: ValidatedCsvRow): BulkImportRow {
  const out: BulkImportRow = toAgentImportRow(row);

  const set = (key: keyof BulkImportRow, value: string | undefined) => {
    if (value && value.trim()) out[key] = value.trim();
  };

  set("source", row.source);
  set("entity_type", row.entity_type);
  set("entity_status", row.entity_status);
  set("registered_agent", row.registered_agent);
  set("source_filing_date", parseFilingDate(row.source_filing_date));
  set("import_notes", row.import_notes);

  return out;
}

export function toBulkImportRows(rows: ValidatedCsvRow[]): BulkImportRow[] {
  return rows.map(toBulkImportRow);
}
