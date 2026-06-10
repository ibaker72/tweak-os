import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { logOpenClawAction } from "@/lib/openclaw/activity";
import { getLeadById } from "@/lib/leads/queries";
import { enrichOneLead } from "@/lib/leads/enrich-flow";
import {
  createEnrichmentJob,
  updateEnrichmentJob,
} from "@/lib/leads/mutations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = guard(request);
  if (!check.ok) return check.response;

  const { id } = await params;
  const supabase = createServiceClient();

  const lead = await getLeadById(supabase, id);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const jobId = await createEnrichmentJob(supabase, id);
  await updateEnrichmentJob(supabase, jobId, {
    status: "in_progress",
    started_at: new Date().toISOString(),
  });
  await supabase
    .from("leads")
    .update({ enrichment_status: "crawling" } as unknown as never)
    .eq("id", id);

  const outcome = await enrichOneLead(supabase, lead);

  if (outcome.status === "failed") {
    await updateEnrichmentJob(supabase, jobId, {
      status: "failed",
      error_message: outcome.error ?? "Enrichment failed",
      completed_at: new Date().toISOString(),
    });
    await logOpenClawAction(supabase, id, "enrich.failed", { error: outcome.error });
    return NextResponse.json(
      { ok: false, error: outcome.error ?? "Enrichment failed" },
      { status: 500 }
    );
  }

  await updateEnrichmentJob(supabase, jobId, {
    status: "completed",
    completed_at: new Date().toISOString(),
  });

  await logOpenClawAction(supabase, id, "enrich.completed", {
    score: outcome.score,
    contact_status: outcome.contact_status,
    online_presence: outcome.online_presence,
  });

  return NextResponse.json({
    ok: true,
    lead_id: id,
    enrichment: {
      score: outcome.score,
      contact_status: outcome.contact_status,
      online_presence: outcome.online_presence,
      enrichment_summary: outcome.enrichment_summary,
      outreach: outcome.outreach,
    },
  });
}
