import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCsvContent } from "@/lib/leads/csv";
import {
  insertLead,
  createImportJob,
  updateImportJob,
} from "@/lib/leads/mutations";
import { findDuplicateLeadForImport } from "@/lib/leads/queries";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".csv")) {
      return NextResponse.json(
        { error: "File must be a CSV" },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const { valid, errors, totalRows, detectedFormat } = parseCsvContent(csvText);

    if (totalRows === 0) {
      return NextResponse.json(
        { error: "CSV file is empty" },
        { status: 400 }
      );
    }

    const jobId = await createImportJob(supabase, file.name, totalRows);

    let importedRows = 0;
    let skippedDuplicates = 0;
    const failures: { row: number; message: string }[] = [...errors];

    // Pre-populate failures for invalid rows we already know about.
    let failedRows = errors.length;

    for (const row of valid) {
      try {
        const dup = await findDuplicateLeadForImport(supabase, {
          business_name: row.business_name,
          state: row.state,
          external_id: row.external_id,
        });
        if (dup.duplicate) {
          skippedDuplicates++;
          continue;
        }

        await insertLead(supabase, row);
        importedRows++;
      } catch (err) {
        failedRows++;
        failures.push({
          row: 0,
          message: `Failed to insert ${row.business_name}: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        });
      }
    }

    await updateImportJob(supabase, jobId, {
      imported_rows: importedRows,
      skipped_rows: skippedDuplicates,
      failed_rows: failedRows,
      status: "completed",
    });

    return NextResponse.json({
      job_id: jobId,
      detected_format: detectedFormat,
      total_rows: totalRows,
      imported_rows: importedRows,
      skipped_duplicates: skippedDuplicates,
      failed_rows: failedRows,
      // Keep `errors` for back-compat with existing UI.
      errors: failures.slice(0, 10),
      first_failure_reasons: failures.slice(0, 10).map((f) => f.message),
    });
  } catch (err) {
    console.error("Import error:", err);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 }
    );
  }
}
