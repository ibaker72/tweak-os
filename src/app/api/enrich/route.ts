import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enrichWebsite } from "@/lib/leads/enrichment";
import { scoreLead } from "@/lib/leads/scoring";
import { generateInsights } from "@/lib/leads/insights";
import { generateOutreach } from "@/lib/leads/outreach";
import { getLeadById } from "@/lib/leads/queries";
import {
  updateLeadEnrichment,
  markLeadEnrichmentFailed,
  createEnrichmentJob,
  updateEnrichmentJob,
  logActivity,
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

    // Update lead status to crawling
    await supabase
      .from("leads")
      .update({ enrichment_status: "crawling" })
      .eq("id", lead_id);

    try {
      // Run enrichment
      const enrichmentResult = await enrichWebsite(lead.website);

      // Score the lead
      const scoreResult = scoreLead(enrichmentResult, {
        website: lead.website,
        niche: lead.niche,
        city: lead.city,
        state: lead.state,
        google_rating: lead.google_rating,
        google_review_count: lead.google_review_count,
      });

      // Generate AI outreach if score >= 40 and Anthropic key is configured
      let outreachData = null;
      if (scoreResult.score >= 40 && process.env.ANTHROPIC_API_KEY) {
        try {
          outreachData = await generateOutreach(lead, enrichmentResult);
        } catch (err) {
          console.error("Outreach generation failed:", err);
          // Fall back to rule-based insights
        }
      }

      // Generate rule-based insights as fallback
      if (!outreachData) {
        const insights = generateInsights(enrichmentResult, {
          business_name: lead.business_name,
          niche: lead.niche,
          website: lead.website,
        });
        outreachData = {
          pain_points: [insights.pain_point_1, insights.pain_point_2],
          offer_angle: insights.offer_angle,
          cold_email: insights.suggested_first_line,
          linkedin_dm: "",
          follow_up_email: "",
        };
      }

      // Save everything
      await updateLeadEnrichment(
        supabase,
        lead_id,
        enrichmentResult,
        scoreResult,
        outreachData
      );

      await updateEnrichmentJob(supabase, jobId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      // Log activity
      await logActivity(supabase, lead_id, "enriched", {
        score: scoreResult.score,
        tech_stack: enrichmentResult.tech_stack,
        emails_found: enrichmentResult.emails.length,
        phones_found: enrichmentResult.phones.length,
      });

      return NextResponse.json({
        success: true,
        enrichment: enrichmentResult,
        score: scoreResult,
        outreach: outreachData,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Enrichment failed";

      await markLeadEnrichmentFailed(supabase, lead_id, errorMessage);
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
