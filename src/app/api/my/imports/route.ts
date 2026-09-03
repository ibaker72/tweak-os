import { NextRequest, NextResponse } from "next/server";
import { parseCsvContent } from "@/lib/leads/csv";
import { toAgentImportRows } from "@/lib/leads/agent-import";
import { buildImportSummary } from "@/lib/leads/import-result";
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
 * Duplicate detection lives entirely in the database, in
 * private.find_duplicate_lead(): normalized phone, then email, then domain,
 * then business name plus location, matched against every lead in the table
 * rather than the ones this agent may read. A row that matches is skipped
 * outright — no second lead, no second attribution, and no change to the
 * existing lead's owner or pipeline state, whoever it belongs to.
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

    return NextResponse.json(
      buildImportSummary({
        rpcResult: (data ?? {}) as Record<string, unknown>,
        parseErrors: errors,
        validRowNumbers,
        totalRows,
        detectedFormat,
        attribution: "self_sourced",
      })
    );
  } catch (err) {
    console.error("Agent import error:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
