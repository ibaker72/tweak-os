import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@/lib/leads/queries";
import { generateOutreach } from "@/lib/leads/outreach";
import { updateLeadOutreach, logActivity } from "@/lib/leads/mutations";
import { trackApiUsage } from "@/lib/leads/api-usage";

// POST /api/outreach — generate AI outreach for a lead
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

    // Track API usage
    await trackApiUsage(supabase, "openai", "gpt-4o-mini");

    // Generate outreach
    const outreach = await generateOutreach(lead);

    // Save to lead
    await updateLeadOutreach(supabase, lead_id, outreach);

    // Log activity
    await logActivity(supabase, lead_id, "outreach_generated", {
      pricing_tier: outreach.pricing_tier,
    });

    return NextResponse.json({ success: true, outreach });
  } catch (err) {
    console.error("Outreach generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Outreach generation failed" },
      { status: 500 }
    );
  }
}

// PATCH /api/outreach — update outreach content for a lead
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { lead_id, outreach } = body;

    if (!lead_id || !outreach) {
      return NextResponse.json(
        { error: "lead_id and outreach are required" },
        { status: 400 }
      );
    }

    await updateLeadOutreach(supabase, lead_id, outreach);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Outreach update error:", err);
    return NextResponse.json(
      { error: "Update failed" },
      { status: 500 }
    );
  }
}
