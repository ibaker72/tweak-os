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
  logActivity,
} from "@/lib/leads/mutations";

const MAX_CONCURRENT = 2;
const DELAY_MS = 1000;

// POST /api/enrich-bulk — enrich multiple leads
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { lead_ids } = body;

    if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      return NextResponse.json(
        { error: "lead_ids array is required" },
        { status: 400 }
      );
    }

    // Mark all as crawling
    await supabase
      .from("leads")
      .update({ enrichment_status: "crawling" })
      .in("id", lead_ids);

    let completed = 0;
    let failed = 0;

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < lead_ids.length; i += MAX_CONCURRENT) {
      const batch = lead_ids.slice(i, i + MAX_CONCURRENT);

      const results = await Promise.allSettled(
        batch.map(async (leadId: string) => {
          const lead = await getLeadById(supabase, leadId);
          if (!lead || !lead.website) {
            await markLeadEnrichmentFailed(supabase, leadId, "No website");
            throw new Error("No website");
          }

          const enrichmentResult = await enrichWebsite(lead.website);
          const scoreResult = scoreLead(enrichmentResult, {
            website: lead.website,
            niche: lead.niche,
            city: lead.city,
            state: lead.state,
            google_rating: lead.google_rating,
            google_review_count: lead.google_review_count,
          });

          // Generate outreach if score >= 40 and OpenAI key is available
          let outreachData = null;
          if (scoreResult.score >= 40 && process.env.OPENAI_API_KEY) {
            try {
              outreachData = await generateOutreach(lead, enrichmentResult);
            } catch {
              // Fall back to rule-based
            }
          }

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

          await updateLeadEnrichment(supabase, leadId, enrichmentResult, scoreResult, outreachData);
          await logActivity(supabase, leadId, "enriched", {
            score: scoreResult.score,
          });
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          completed++;
        } else {
          failed++;
        }
      }

      // Delay between batches
      if (i + MAX_CONCURRENT < lead_ids.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    return NextResponse.json({
      success: true,
      total: lead_ids.length,
      completed,
      failed,
    });
  } catch (err) {
    console.error("Bulk enrich error:", err);
    return NextResponse.json(
      { error: "Bulk enrichment failed" },
      { status: 500 }
    );
  }
}
