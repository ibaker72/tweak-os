import Papa from "papaparse";
import { csvLeadRowSchema, type ValidatedCsvRow } from "@/lib/validators/import";

export type CsvFormat = "standard" | "nj_business_records";

export interface CsvParseResult {
  valid: ValidatedCsvRow[];
  /**
   * Spreadsheet line number for each entry of `valid`, header included in the
   * count — the number the partner sees in Google Sheets.
   *
   * The importer only ever receives the rows that validated, so it numbers its
   * results 1..valid.length. Without this the import summary would point at
   * "row 5" when the partner's row 5 was one the parser had already dropped.
   */
  validRowNumbers: number[];
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
  const address = pickByNormalizedKey(row, [
    "Address",
    "RegAgentStreet",
    "RegAgentAddress",
    "RegAgentAddress1",
    "RegAgentAddr",
    "RegAgentStreet1",
    "MainOfficeStreet",
    "MainOfficeAddress",
    "PrincipalOfficeStreet",
    "PrincipalOfficeAddress",
  ]);
  const zip = pickByNormalizedKey(row, [
    "Zip",
    "ZipCode",
    "PostalCode",
    "RegAgentZip",
    "RegAgentZipCode",
    "RegAgentZIPCode",
    "RegAgentPostalCode",
    "MainOfficeZip",
    "MainOfficePostalCode",
  ]);
  const website = pickByNormalizedKey(row, ["Website", "URL"]);
  const phone = pickByNormalizedKey(row, ["Phone", "PhoneNumber", "Telephone"]);
  const email = pickByNormalizedKey(row, ["Email", "EmailAddress"]);
  const industry = pickByNormalizedKey(row, ["Industry", "NAICS", "NAICSDescription"]);

  return {
    business_name: businessName,
    state: stateDom || "NJ",
    city,
    address,
    zip,
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
    // Always echo NJ metadata into import_notes so nothing is lost when
    // dedicated columns are null or trimmed by the DB driver.
    import_notes: buildImportNotes([
      ["BusinessID", businessId],
      ["FilingDate", filingDate],
      ["TypeCode", typeCode],
      ["Status", status],
      ["RegAgent", regAgent],
      ["RegAgentAddress", address],
      ["RegAgentCity", city],
      ["RegAgentZip", zip],
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
  const validRowNumbers: number[] = [];
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
      validRowNumbers.push(i + 2);
    } else {
      const messages = result.error.issues.map((e) => e.message).join("; ");
      errors.push({ row: i + 2, message: messages });
    }
  }

  return {
    valid,
    validRowNumbers,
    errors,
    totalRows: dataRows.length,
    detectedFormat,
  };
}

const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "west virginia", "wisconsin", "wyoming",
  "district of columbia",
]);

/**
 * Header aliases for hand-maintained research sheets.
 *
 * Agents source leads in Google Sheets with whatever column names read
 * naturally to them — "Company", "Decision Maker", "Phone Number". Each entry
 * maps one such heading onto a field the importer already understands.
 *
 * Keys are normalized (lowercased, non-alphanumerics stripped), so "Phone
 * Number", "phone_number" and "PhoneNumber" all resolve through one entry.
 * Aliases only ever FILL an empty field, so a sheet carrying a real
 * `business_name` column keeps it and every CSV that imported before this
 * still imports identically.
 */
const STANDARD_HEADER_ALIASES: Record<string, string> = {
  company: "business_name",
  companyname: "business_name",
  businessname: "business_name",
  business: "business_name",
  type: "niche",
  industry: "niche",
  niche: "niche",
  city: "city",
  state: "state",
  decisionmaker: "contact_name",
  contactname: "contact_name",
  contact: "contact_name",
  email: "email",
  emailaddress: "email",
  website: "website",
  url: "website",
  phone: "phone",
  phonenumber: "phone",
  telephone: "phone",
  notes: "notes",
  note: "notes",
};

/** Fields a standard CSV writes straight through from an exactly-named header. */
const PASSTHROUGH_FIELDS = new Set([
  "business_name", "city", "state", "website", "phone", "email", "source",
  "niche", "industry", "contact_name", "notes", "external_id", "entity_type",
  "entity_status", "registered_agent", "source_filing_date", "import_notes",
  "address", "zip",
]);

/** Headers carrying city and state in one column ("City, State", "Location"). */
const COMBINED_LOCATION_HEADERS = new Set(["citystate", "cityandstate", "location"]);

/** The label the UI shows for a header that fills both city and state. */
export const COMBINED_LOCATION_LABEL = "city + state";

/**
 * Split "Newark, NJ" into its parts.
 *
 * Only the last comma-separated segment is treated as a state, and only when
 * it looks like one — a two-letter code or a spelled-out state name.
 * Otherwise the whole value stays the city: guessing wrong here writes a
 * nonsense state onto a lead, and the state is half of the duplicate key.
 */
export function splitCityState(raw: string): { city?: string; state?: string } {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { city: parts[0] };

  const tail = parts[parts.length - 1];
  const isAbbreviation = /^[A-Za-z]{2}$/.test(tail);
  if (!isAbbreviation && !US_STATE_NAMES.has(tail.toLowerCase())) {
    return { city: parts.join(", ") };
  }

  const city = parts.slice(0, -1).join(", ");
  return {
    city: city || undefined,
    state: isAbbreviation ? tail.toUpperCase() : tail,
  };
}

/**
 * Which canonical field a header in a standard CSV resolves to, or null when
 * the importer ignores it.
 *
 * Exported so the upload screen can preview the mapping before anything is
 * written — the preview and the import agree because they read the same
 * tables. Aliases are consulted before the passthrough list so that
 * "Industry" reports the field it actually lands in (niche).
 */
export function mapStandardHeader(header: string): string | null {
  const trimmed = header.trim();
  if (!trimmed) return null;

  const key = normalizeKey(trimmed);
  if (COMBINED_LOCATION_HEADERS.has(key)) return COMBINED_LOCATION_LABEL;

  const alias = STANDARD_HEADER_ALIASES[key];
  if (alias) return alias;

  const snake = trimmed.toLowerCase().replace(/\s+/g, "_");
  return PASSTHROUGH_FIELDS.has(snake) ? snake : null;
}

// Normalize standard CSV: lower_snake_case headers, pass through known fields,
// then fill anything still empty from the alias table above.
function normalizeStandardRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
    out[normalized] = value;
  }

  const text = (value: unknown): string | undefined => {
    if (value == null) return undefined;
    const s = String(value).trim();
    return s || undefined;
  };

  const fill = (field: string, value: string | undefined) => {
    if (value && !text(out[field])) out[field] = value;
  };

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeKey(key);
    const v = text(value);
    if (!v) continue;

    if (COMBINED_LOCATION_HEADERS.has(normalizedKey)) {
      const { city, state } = splitCityState(v);
      fill("city", city);
      fill("state", state);
      continue;
    }

    const target = STANDARD_HEADER_ALIASES[normalizedKey];
    if (target) fill(target, v);
  }

  // A single "City" column often holds "Newark, NJ" anyway. Split it only when
  // there is no state of its own to overwrite.
  const city = text(out.city);
  if (city && city.includes(",") && !text(out.state)) {
    const split = splitCityState(city);
    if (split.state) {
      out.city = split.city;
      out.state = split.state;
    }
  }

  return out;
}

export function leadsToCSV(
  leads: Array<Record<string, unknown>>
): string {
  return Papa.unparse(leads);
}
