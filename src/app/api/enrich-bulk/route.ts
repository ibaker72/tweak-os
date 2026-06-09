import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@/lib/leads/queries";
import { enrichOneLead } from "@/lib/leads/enrich-flow";
import { logActivity } from "@/lib/leads/mutations";

const MAX_CONCURRENT = 2;
const DELAY_MS = 1000;
const MAX_BULK_LEADS = 100;

const bulkSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(MAX_BULK_LEADS),
});

// POST /api/enrich-bulk — enrich multiple leads
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { lead_ids } = parsed.data;

    // Mark all as crawling
    await supabase
      .from("leads")
      .update({ enrichment_status: "crawling" })
      .in("id", lead_ids);

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < lead_ids.length; i += MAX_CONCURRENT) {
      const batch = lead_ids.slice(i, i + MAX_CONCURRENT);

      const results = await Promise.allSettled(
        batch.map(async (leadId: string) => {
          const lead = await getLeadById(supabase, leadId);
          if (!lead) throw new Error("Lead not found");
          const outcome = await enrichOneLead(supabase, lead);
          if (outcome.status === "failed") {
            throw new Error(outcome.error ?? "Enrichment failed");
          }
          await logActivity(supabase, leadId, "enriched", {
            score: outcome.score,
            contact_status: outcome.contact_status,
            online_presence: outcome.online_presence,
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
      { error: err instanceof Error ? err.message : "Bulk enrichment failed" },
      { status: 500 }
    );
  }
}
