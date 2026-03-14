import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCsvContent } from "@/lib/leads/csv";
import { insertLead } from "@/lib/leads/mutations";
import {
  createImportJob,
  updateImportJob,
} from "@/lib/leads/mutations";
import { checkDuplicateLead } from "@/lib/leads/queries";

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
    const { valid, errors, totalRows } = parseCsvContent(csvText);

    if (totalRows === 0) {
      return NextResponse.json(
        { error: "CSV file is empty" },
        { status: 400 }
      );
    }

    // Create import job
    const jobId = await createImportJob(supabase, file.name, totalRows);

    let importedRows = 0;
    let failedRows = errors.length;
    const importErrors = [...errors];

    // Insert valid rows
    for (const row of valid) {
      try {
        // Check for duplicates
        const isDuplicate = await checkDuplicateLead(
          supabase,
          row.business_name,
          row.website
        );
        if (isDuplicate) {
          failedRows++;
          importErrors.push({
            row: 0,
            message: `Duplicate: ${row.business_name}`,
          });
          continue;
        }

        await insertLead(supabase, row);
        importedRows++;
      } catch (err) {
        failedRows++;
        importErrors.push({
          row: 0,
          message: `Failed to insert ${row.business_name}: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    }

    // Update job
    await updateImportJob(supabase, jobId, {
      imported_rows: importedRows,
      failed_rows: failedRows,
      status: "completed",
    });

    return NextResponse.json({
      job_id: jobId,
      total_rows: totalRows,
      imported_rows: importedRows,
      failed_rows: failedRows,
      errors: importErrors.slice(0, 20), // Limit error list
    });
  } catch (err) {
    console.error("Import error:", err);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 }
    );
  }
}
