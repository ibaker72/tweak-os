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
import { trackApiUsage } from "@/lib/leads/api-usage";
import { z } from "zod";

const discoveryInputSchema = z.object({
  niche: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  keyword: z.string().default(""),
  source: z.enum(["manual", "url_list", "google_places", "google_search"]).default("google_places"),
  urls: z.string().optional(),
  radius: z.number().optional(),
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
      // Track API usage
      if (input.source === "google_places") {
        await trackApiUsage(supabase, "google_places", "textsearch");
      } else if (input.source === "google_search") {
        await trackApiUsage(supabase, "google_search", "search");
      }

      // Run discovery
      const results = await runDiscovery(input);

      // Phase 6: Cross-batch dedup — check discovered websites against existing leads
      if (results.length > 0) {
        const { data: existingLeads } = await supabase
          .from("leads")
          .select("id, website")
          .not("website", "is", null);

        if (existingLeads && existingLeads.length > 0) {
          const existingDomains = new Map<string, string>();
          for (const lead of existingLeads) {
            if (lead.website) {
              const domain = extractRootDomain(lead.website);
              if (domain) existingDomains.set(domain, lead.id);
            }
          }

          for (const result of results) {
            if (result.website) {
              const domain = extractRootDomain(result.website);
              if (domain && existingDomains.has(domain)) {
                result.is_duplicate = true;
                result.duplicate_lead_id = existingDomains.get(domain)!;
              }
            }
          }
        }

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

function extractRootDomain(url: string): string | null {
  try {
    const hostname = new URL(
      url.startsWith("http") ? url : `https://${url}`
    ).hostname.replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
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
