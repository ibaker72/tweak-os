// The shape both import routes return, and the words the summary screen puts
// on each row.
//
// One module because the two importers must stay describable in the same
// terms: a partner uploading their own sheet and an admin uploading the team's
// get the same five counts and the same per-row verdicts, so "7 imported, 7
// duplicates" means the same thing on both screens.

import { describeDuplicateReason } from "./normalize";

/** What happened to one CSV row. */
export type ImportRowStatus =
  | "imported"
  | "duplicate_skipped"
  | "invalid"
  | "failed";

export interface ImportRowResult {
  /** 1-based line in the uploaded file, header excluded. */
  row: number;
  business_name: string | null;
  status: ImportRowStatus;
  /** Which dedupe tier matched, on a duplicate_skipped row. */
  reason?: string | null;
  /** True when the lead this row duplicates is already owned by someone else. */
  owned_by_other_agent?: boolean;
  /** Why the row was rejected, on an invalid or failed row. */
  message?: string | null;
  lead_id?: string | null;
}

export interface ImportSummaryResult {
  job_id?: string;
  detected_format?: "standard" | "nj_business_records";
  total_rows: number;
  imported_rows: number;
  skipped_duplicates: number;
  invalid_rows: number;
  failed_rows: number;
  /** Per-row detail, capped server-side; see results_truncated. */
  results: ImportRowResult[];
  results_truncated: boolean;
  attribution?: "self_sourced";
  /** Kept so older callers of these routes keep working. */
  errors: { row: number; message: string }[];
  first_failure_reasons: string[];
}

/**
 * The sentence shown next to a row in the import summary.
 *
 * A skipped row says which identifier matched, because "Skipped: existing
 * phone match" tells a partner their sheet is fine and the lead is already in
 * the system, where a bare "Skipped" reads like something went wrong.
 */
export function describeRowResult(result: ImportRowResult): string {
  switch (result.status) {
    case "imported":
      return "Imported";
    case "duplicate_skipped": {
      const base = describeDuplicateReason(result.reason);
      // Worth saying out loud: the lead stays with whoever sourced it first.
      // Re-uploading a sheet does not move it, and does not earn a second
      // commission claim on it.
      return result.owned_by_other_agent ? `${base} (owned by another partner)` : base;
    }
    case "invalid":
      return result.message ? `Invalid: ${result.message}` : "Invalid row";
    case "failed":
      return result.message ? `Failed: ${result.message}` : "Failed";
  }
}

/** Narrow whatever the RPC returned into typed row results. */
export function toRowResults(
  raw: unknown,
  lineNumberFor: (rowIndex: number) => number
): ImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportRowResult[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const status = r.status;
    if (
      status !== "imported" &&
      status !== "duplicate_skipped" &&
      status !== "invalid" &&
      status !== "failed"
    ) {
      continue;
    }
    const index = typeof r.row === "number" ? r.row : 0;
    out.push({
      row: lineNumberFor(index),
      business_name: typeof r.business_name === "string" ? r.business_name : null,
      status,
      reason: typeof r.reason === "string" ? r.reason : null,
      owned_by_other_agent: r.owned_by_other_agent === true,
      message: typeof r.message === "string" ? r.message : null,
      lead_id: typeof r.lead_id === "string" ? r.lead_id : null,
    });
  }
  return out;
}

/** Upper bound on the per-row list the routes hand the browser. */
const MAX_ROW_RESULTS = 250;

/**
 * Assemble the response both import routes return.
 *
 * The counts come from the database function, which is the only thing that
 * knows what it actually wrote. The row list is stitched from two places: the
 * parser's rejections, which never reached the database, and the function's
 * own verdicts — renumbered from "nth row I was given" back to the line in the
 * partner's spreadsheet.
 */
export function buildImportSummary(args: {
  rpcResult: Record<string, unknown>;
  parseErrors: { row: number; message: string }[];
  validRowNumbers: number[];
  totalRows: number;
  detectedFormat: "standard" | "nj_business_records";
  attribution?: "self_sourced";
}): ImportSummaryResult {
  const { rpcResult, parseErrors, validRowNumbers, totalRows, detectedFormat } = args;

  const num = (key: string): number => {
    const value = rpcResult[key];
    return typeof value === "number" ? value : 0;
  };

  const rpcRows = toRowResults(
    rpcResult.results,
    // The function numbers the rows it was handed, 1-based; the parser knows
    // which spreadsheet line each of those came from.
    (index) => validRowNumbers[index - 1] ?? index
  );

  const invalidRows: ImportRowResult[] = parseErrors.map((e) => ({
    row: e.row,
    business_name: null,
    status: "invalid" as const,
    message: e.message,
  }));

  const results = [...invalidRows, ...rpcRows]
    .sort((a, b) => a.row - b.row)
    .slice(0, MAX_ROW_RESULTS);

  const rpcFailures = Array.isArray(rpcResult.failures)
    ? (rpcResult.failures as { row: number; message: string }[])
    : [];
  const errors = [...parseErrors, ...rpcFailures];

  return {
    job_id: typeof rpcResult.job_id === "string" ? rpcResult.job_id : undefined,
    detected_format: detectedFormat,
    total_rows: num("total_rows") || totalRows,
    imported_rows: num("imported_rows"),
    skipped_duplicates: num("skipped_duplicates"),
    invalid_rows: num("invalid_rows"),
    failed_rows: num("failed_rows"),
    results,
    results_truncated:
      rpcResult.results_truncated === true ||
      invalidRows.length + rpcRows.length > MAX_ROW_RESULTS,
    attribution: args.attribution,
    // Kept for back-compat with anything still reading the old shape.
    errors: errors.slice(0, 10),
    first_failure_reasons: errors.slice(0, 10).map((f) => f.message),
  };
}
