import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDiscovery } from "@/lib/leads/discovery";
import {
  createDiscoveryJob,
  updateDiscoveryJob,
  insertDiscoveryResults,
  importDiscoveryResults,
} from "@/lib/leads/mutations";
import { getDiscoveryResults } from "@/lib/leads/queries";
import { z } from "zod";

const discoveryInputSchema = z.object({
  niche: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  keyword: z.string().default(""),
  source: z.enum(["manual", "url_list", "yelp"]).default("url_list"),
  urls: z.string().optional(),
});

const importSchema = z.object({
  result_ids: z.array(z.string().uuid()).min(1),
});

// POST /api/discover — run discovery
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const input = discoveryInputSchema.parse(body);

    // Create job
    const jobId = await createDiscoveryJob(supabase, input);

    try {
      // Run discovery
      const results = await runDiscovery(input);

      // Store results
      if (results.length > 0) {
        await insertDiscoveryResults(supabase, jobId, results);
      }

      await updateDiscoveryJob(supabase, jobId, {
        status: "completed",
        total_found: results.length,
      });

      // Fetch stored results to return with IDs
      const storedResults = await getDiscoveryResults(supabase, jobId);

      return NextResponse.json({
        job_id: jobId,
        total_found: results.length,
        results: storedResults,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Discovery failed";
      await updateDiscoveryJob(supabase, jobId, {
        status: "failed",
        error_message: msg,
      });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Discovery error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT /api/discover — import selected discovery results into leads
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { result_ids } = importSchema.parse(body);

    const result = await importDiscoveryResults(supabase, result_ids);

    return NextResponse.json({
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Import discovery results error:", err);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 }
    );
  }
}
