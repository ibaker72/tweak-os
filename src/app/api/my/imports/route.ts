import { NextRequest, NextResponse } from "next/server";
import { parseCsvContent } from "@/lib/leads/csv";
import { toAgentImportRows } from "@/lib/leads/agent-import";
import { requireUser } from "@/lib/auth/guard";

/**
 * POST /api/my/imports — an agent imports their own sourced leads.
 *
 * Phase 1 blocks agents from creating leads and this route does not lift that:
 * there is still no INSERT policy on `leads` for agents. The rows go through
 * public.import_agent_leads(), a SECURITY DEFINER function that takes the
 * crediting agent from the JWT rather than from anything sent here.
 *
 * Note what this handler cannot do even if it wanted to. It holds the caller's
 * RLS-bound client, not the service role, so it has no direct write on `leads`
 * or `attributions`. And the payload it builds is a whitelist — there is no
 * assigned_to, agent_id or attribution field in it, and the function would
 * ignore them anyway. Ownership is decided in one place, server-side.
 *
 * The admin importer at POST /api/imports is untouched and still admin-only.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

export async function POST(request: NextRequest) {
  const guard = await requireUser();
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
    const { valid, errors, totalRows, detectedFormat } = parseCsvContent(csvText);

    if (totalRows === 0) {
      return NextResponse.json({ error: "CSV file is empty" }, { status: 400 });
    }
    if (totalRows > MAX_ROWS) {
      return NextResponse.json(
        { error: `CSV has ${totalRows} rows; the limit is ${MAX_ROWS} per import.` },
        { status: 413 }
      );
    }

    const { data, error } = await guard.supabase.rpc("import_agent_leads", {
      p_rows: toAgentImportRows(valid),
      p_filename: file.name,
      // Rows the parser rejected never reach the database. Handing over the
      // count keeps the import job's totals equal to the file the agent
      // uploaded instead of only the part of it that parsed.
      p_parse_failures: errors.length,
    });

    if (error) {
      // Raised when the caller has no active agent profile. The guard already
      // checks that, so reaching this means the profile was deactivated
      // mid-request.
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Your account cannot import leads" },
          { status: 403 }
        );
      }
      throw error;
    }

    const result = (data ?? {}) as {
      job_id?: string;
      imported_rows?: number;
      skipped_duplicates?: number;
      failed_rows?: number;
      failures?: { row: number; message: string }[];
    };

    // The function already counts the rejected rows into failed_rows; their
    // messages live here, so the two lists are merged for the summary.
    const parseFailures = errors.map((e) => ({ row: e.row, message: e.message }));
    const failures = [...parseFailures, ...(result.failures ?? [])];

    return NextResponse.json({
      job_id: result.job_id,
      detected_format: detectedFormat,
      total_rows: totalRows,
      imported_rows: result.imported_rows ?? 0,
      skipped_duplicates: result.skipped_duplicates ?? 0,
      failed_rows: result.failed_rows ?? 0,
      attribution: "self_sourced",
      errors: failures.slice(0, 10),
      first_failure_reasons: failures.slice(0, 10).map((f) => f.message),
    });
  } catch (err) {
    console.error("Agent import error:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
