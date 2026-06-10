import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { logOpenClawAction } from "@/lib/openclaw/activity";
import {
  buildDefaultServices,
  calculateTotals,
  isLaunchKitLead,
} from "@/lib/proposals/pricing";

export const runtime = "nodejs";

const bodySchema = z.object({
  lead_id: z.string().uuid(),
  package: z.string().min(1).max(120).default("New Business Launch Kit"),
  price_mode: z.enum(["one_time", "setup_plus_monthly"]).default("one_time"),
  custom_notes: z.string().max(5000).optional(),
});

export async function POST(request: NextRequest) {
  const check = guard(request);
  if (!check.ok) return check.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { lead_id, package: pkg, price_mode, custom_notes } = parsed.data;
  const supabase = createServiceClient();

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select(
      "id, business_name, niche, category, website, source, source_filing_date, created_at"
    )
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr) {
    console.error("[openclaw] proposal lead lookup error:", leadErr);
    return NextResponse.json({ error: "Failed to load lead" }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const leadRow = lead as Record<string, unknown>;
  const leadPricingContext = {
    source: (leadRow.source as string | null) ?? null,
    website: (leadRow.website as string | null) ?? null,
    source_filing_date: (leadRow.source_filing_date as string | null) ?? null,
    created_at: (leadRow.created_at as string | null) ?? null,
  };
  const launchKitFit = isLaunchKitLead(leadPricingContext);
  const services = buildDefaultServices({
    packageName: pkg,
    priceMode: price_mode,
    lead: leadPricingContext,
  });
  const { total_one_time, total_monthly } = calculateTotals(services);

  const now = new Date().toISOString();
  const insertPayload = {
    lead_id,
    client_name: (leadRow.business_name as string) ?? null,
    business_type:
      (leadRow.niche as string | null) ?? (leadRow.category as string | null) ?? null,
    website_url: (leadRow.website as string | null) ?? null,
    services_json: services,
    proposal_html: "",
    proposal_text: custom_notes ?? null,
    proposal_sections: {
      executive_summary: "",
      what_we_found: "",
      our_recommendation: "",
      investment_summary: "",
      what_happens_next: "",
      about: "",
      custom_notes: custom_notes ?? "",
    },
    total_one_time,
    total_monthly,
    status: "draft",
    last_edited_at: now,
  };

  const { data, error } = await supabase
    .from("proposals")
    .insert(insertPayload as unknown as never)
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();

  if (error) {
    console.error("[openclaw] proposal insert error:", error);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }

  await logOpenClawAction(supabase, lead_id, "proposal.created", {
    proposal_id: data.id,
    package: pkg,
    price_mode,
    total_one_time,
    total_monthly,
    launch_kit_fit: launchKitFit,
  });

  const origin = request.headers.get("origin") ?? request.nextUrl.origin;
  const previewUrl = `${origin}/proposals?id=${data.id}`;

  return NextResponse.json({
    ok: true,
    proposal_id: data.id,
    status: "draft",
    preview_url: previewUrl,
    totals: { total_one_time, total_monthly },
    services,
  });
}
