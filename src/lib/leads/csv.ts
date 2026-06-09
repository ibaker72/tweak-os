import Papa from "papaparse";
import { csvLeadRowSchema, type ValidatedCsvRow } from "@/lib/validators/import";

export type CsvFormat = "standard" | "nj_business_records";

export interface CsvParseResult {
  valid: ValidatedCsvRow[];
  errors: { row: number; message: string }[];
  totalRows: number;
  detectedFormat: CsvFormat;
}

const NJ_SOURCE_LABEL = "NJ Business Records";

// Header keys are normalized: lowercased and stripped of non-alphanumeric chars.
// This lets "Business Name", "business_name", "BusinessName" all collide.
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// NJ exports use CamelCase headers (BusinessName, BusinessID, …) — distinct from
// our standard snake_case (business_name). We require BOTH an exact-cased
// `BusinessName` header AND at least one other NJ-specific column so a stray
// "businessname" header in a custom file doesn't collide with the standard path.
function isNjFormat(rawRow: Record<string, unknown>): boolean {
  const headers = Object.keys(rawRow);
  if (!headers.includes("BusinessName")) return false;
  const njMarkers = ["BusinessID", "Status", "FilingDate", "TypeCode", "StateDom", "RegAgent"];
  return njMarkers.some((m) => headers.includes(m));
}

function pickByNormalizedKey(
  row: Record<string, unknown>,
  candidates: string[]
): string | undefined {
  const want = new Set(candidates.map(normalizeKey));
  for (const [key, value] of Object.entries(row)) {
    if (want.has(normalizeKey(key))) {
      if (value == null) continue;
      const s = String(value).trim();
      if (s) return s;
    }
  }
  return undefined;
}

function buildImportNotes(parts: Array<[string, string | undefined]>): string | undefined {
  const filled = parts
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}: ${(v as string).trim()}`);
  return filled.length > 0 ? filled.join(" | ") : undefined;
}

function normalizeNjRow(row: Record<string, unknown>): Record<string, unknown> {
  const businessName = pickByNormalizedKey(row, ["BusinessName"]);
  const businessId = pickByNormalizedKey(row, ["BusinessID", "Business_ID"]);
  const status = pickByNormalizedKey(row, ["Status"]);
  const filingDate = pickByNormalizedKey(row, ["FilingDate", "Filing_Date"]);
  const typeCode = pickByNormalizedKey(row, ["TypeCode", "Type_Code", "Type"]);
  const stateDom = pickByNormalizedKey(row, ["StateDom", "State_Dom", "State"]);
  const regAgent = pickByNormalizedKey(row, ["RegAgent", "Reg_Agent", "RegisteredAgent"]);
  const city = pickByNormalizedKey(row, [
    "City",
    "BusinessCity",
    "RegAgentCity",
    "MainOfficeCity",
  ]);
  const website = pickByNormalizedKey(row, ["Website", "URL"]);
  const phone = pickByNormalizedKey(row, ["Phone", "PhoneNumber", "Telephone"]);
  const email = pickByNormalizedKey(row, ["Email", "EmailAddress"]);
  const industry = pickByNormalizedKey(row, ["Industry", "NAICS", "NAICSDescription"]);

  return {
    business_name: businessName,
    state: stateDom || "NJ",
    city,
    website,
    phone,
    email,
    industry,
    source: NJ_SOURCE_LABEL,
    external_id: businessId,
    entity_type: typeCode,
    entity_status: status,
    registered_agent: regAgent,
    source_filing_date: filingDate,
    import_notes: buildImportNotes([
      ["BusinessID", businessId],
      ["FilingDate", filingDate],
      ["TypeCode", typeCode],
      ["Status", status],
      ["RegAgent", regAgent],
    ]),
  };
}

export function parseCsvContent(csvText: string): CsvParseResult {
  // Preserve original headers so we can detect NJ format. Header normalization
  // happens per-row below — different formats need different mappings.
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const dataRows = parsed.data;
  const detectedFormat: CsvFormat =
    dataRows.length > 0 && isNjFormat(dataRows[0]) ? "nj_business_records" : "standard";

  const valid: ValidatedCsvRow[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i];
    const candidate =
      detectedFormat === "nj_business_records"
        ? normalizeNjRow(rawRow)
        : normalizeStandardRow(rawRow);

    const result = csvLeadRowSchema.safeParse(candidate);
    if (result.success) {
      valid.push(result.data);
    } else {
      const messages = result.error.issues.map((e) => e.message).join("; ");
      errors.push({ row: i + 2, message: messages });
    }
  }

  return {
    valid,
    errors,
    totalRows: dataRows.length,
    detectedFormat,
  };
}

// Normalize standard CSV: lower_snake_case headers, pass through known fields.
function normalizeStandardRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
    out[normalized] = value;
  }
  return out;
}

export function leadsToCSV(
  leads: Array<Record<string, unknown>>
): string {
  return Papa.unparse(leads);
}
