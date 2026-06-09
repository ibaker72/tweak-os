import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@/lib/leads/queries";
import { enrichOneLead } from "@/lib/leads/enrich-flow";
import {
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
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const jobId = await createEnrichmentJob(supabase, lead_id);
    await updateEnrichmentJob(supabase, jobId, {
      status: "in_progress",
      started_at: new Date().toISOString(),
    });
    await supabase
      .from("leads")
      .update({ enrichment_status: "crawling" })
      .eq("id", lead_id);

    const outcome = await enrichOneLead(supabase, lead);

    if (outcome.status === "failed") {
      await updateEnrichmentJob(supabase, jobId, {
        status: "failed",
        error_message: outcome.error ?? "Enrichment failed",
        completed_at: new Date().toISOString(),
      });
      // Surface the real reason — never just "failed".
      return NextResponse.json(
        { error: outcome.error ?? "Enrichment failed" },
        { status: 500 }
      );
    }

    await updateEnrichmentJob(supabase, jobId, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });

    await logActivity(supabase, lead_id, "enriched", {
      score: outcome.score,
      contact_status: outcome.contact_status,
      online_presence: outcome.online_presence,
    });

    return NextResponse.json({
      success: true,
      score: outcome.score,
      contact_status: outcome.contact_status,
      online_presence: outcome.online_presence,
      enrichment_summary: outcome.enrichment_summary,
      outreach: outcome.outreach,
    });
  } catch (err) {
    console.error("Enrich API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
