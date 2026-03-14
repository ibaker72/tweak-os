import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enrichWebsite } from "@/lib/leads/enrichment";
import { scoreLead } from "@/lib/leads/scoring";
import { generateInsights } from "@/lib/leads/insights";
import { getLeadById } from "@/lib/leads/queries";
import {
  updateLeadEnrichment,
  markLeadEnrichmentFailed,
  createEnrichmentJob,
  updateEnrichmentJob,
} from "@/lib/leads/mutations";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { lead_id } = body;

    if (!lead_id) {
      return NextResponse.json(
        { error: "lead_id is required" },
        { status: 400 }
      );
    }

    const lead = await getLeadById(supabase, lead_id);
    if (!lead) {
      return NextResponse.json(
        { error: "Lead not found" },
        { status: 404 }
      );
    }

    if (!lead.website) {
      return NextResponse.json(
        { error: "Lead has no website to enrich" },
        { status: 400 }
      );
    }

    // Create enrichment job
    const jobId = await createEnrichmentJob(supabase, lead_id);
    await updateEnrichmentJob(supabase, jobId, {
      status: "in_progress",
      started_at: new Date().toISOString(),
    });

    // Update lead status
    await supabase
      .from("leads")
      .update({ enrichment_status: "in_progress" })
      .eq("id", lead_id);

    try {
      // Run enrichment
      const enrichmentResult = await enrichWebsite(lead.website);

      // Score the lead
      const scoreResult = scoreLead(enrichmentResult, {
        website: lead.website,
        niche: lead.niche,
      });

      // Generate insights
      const insights = generateInsights(enrichmentResult, {
        business_name: lead.business_name,
        niche: lead.niche,
        website: lead.website,
      });

      // Save everything
      await updateLeadEnrichment(
        supabase,
        lead_id,
        enrichmentResult,
        scoreResult,
        insights
      );

      await updateEnrichmentJob(supabase, jobId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        enrichment: enrichmentResult,
        score: scoreResult,
        insights,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Enrichment failed";

      await markLeadEnrichmentFailed(supabase, lead_id);
      await updateEnrichmentJob(supabase, jobId, {
        status: "failed",
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      });

      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Enrich API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
