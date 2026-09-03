import { NextRequest, NextResponse } from "next/server";
import { parseCsvContent } from "@/lib/leads/csv";
import { toBulkImportRows } from "@/lib/leads/agent-import";
import { buildImportSummary } from "@/lib/leads/import-result";
import { requireAdmin } from "@/lib/auth/guard";

/**
 * POST /api/imports — an admin bulk-imports leads for the team.
 *
 * This used to parse the CSV and then, per row, ask PostgREST "does a lead
 * like this exist?" before inserting. Two problems with that, both of which
 * showed up as duplicate leads:
 *
 *   * check and insert were separate statements in separate transactions, so
 *     two overlapping uploads each saw an empty table and each inserted;
 *   * the check itself matched business_name with ILIKE against the raw value,
 *     where `%` and `_` are wildcards — a company called "100% Roofing"
 *     matched anything starting "100" and ending " Roofing".
 *
 * Both are gone: the whole import is now one call to public.import_bulk_leads(),
 * which does the matching in SQL against every lead in the table, inside one
 * transaction, behind the same advisory lock the agent importer takes.
 *
 * What has not changed is who gets the credit. A bulk upload sources for the
 * team, so it assigns nobody and writes no attribution — the payload has no
 * ownership field and the function has no ownership parameter.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "File must be a CSV" }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "CSV is larger than 5 MB. Split it and import in parts." },
        { status: 413 }
      );
    }

    const csvText = await file.text();
    const { valid, validRowNumbers, errors, totalRows, detectedFormat } =
      parseCsvContent(csvText);

    if (totalRows === 0) {
      return NextResponse.json({ error: "CSV file is empty" }, { status: 400 });
    }

    if (totalRows > MAX_ROWS) {
      return NextResponse.json(
        { error: `CSV has ${totalRows} rows; the limit is ${MAX_ROWS} per import.` },
        { status: 413 }
      );
    }

    const { data, error } = await guard.supabase.rpc("import_bulk_leads", {
      p_rows: toBulkImportRows(valid),
      p_filename: file.name,
      // Rows the parser rejected never reach the database. Handing over the
      // count keeps the import job's totals equal to the file that was
      // uploaded rather than only the part of it that parsed.
      p_parse_failures: errors.length,
    });

    if (error) {
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Your account cannot run bulk imports" },
          { status: 403 }
        );
      }
      throw error;
    }

    return NextResponse.json(
      buildImportSummary({
        rpcResult: (data ?? {}) as Record<string, unknown>,
        parseErrors: errors,
        validRowNumbers,
        totalRows,
        detectedFormat,
      })
    );
  } catch (err) {
    console.error("Import error:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
