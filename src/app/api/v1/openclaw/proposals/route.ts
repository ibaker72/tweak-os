import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { logOpenClawAction } from "@/lib/openclaw/activity";
import {
  SERVICE_CATALOG,
  type ProposalService,
} from "@/lib/proposals/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  lead_id: z.string().uuid(),
  package: z.string().min(1).max(120).default("New Business Launch Kit"),
  price_mode: z.enum(["one_time", "setup_plus_monthly"]).default("one_time"),
  custom_notes: z.string().max(5000).optional(),
});

// Default service bundles for the two pricing modes. We use the
// existing service catalog where possible so totals stay consistent
// with what the in-app composer would produce.
function buildDefaultServices(
  packageName: string,
  priceMode: "one_time" | "setup_plus_monthly"
): ProposalService[] {
  const foundation = SERVICE_CATALOG.find((s) => s.id === "foundation-website");
  const growth = SERVICE_CATALOG.find((s) => s.id === "growth-website-system");
  const seo = SERVICE_CATALOG.find((s) => s.id === "monthly-seo-maintenance");

  if (priceMode === "setup_plus_monthly") {
    const services: ProposalService[] = [];
    if (growth) {
      services.push({ name: packageName, price: growth.price, billing: "one-time" });
    } else {
      services.push({ name: packageName, price: 6500, billing: "one-time" });
    }
    if (seo) {
      services.push({ name: "Monthly SEO Maintenance", price: seo.price, billing: "monthly" });
    } else {
      services.push({ name: "Monthly Care + SEO", price: 400, billing: "monthly" });
    }
    return services;
  }

  return [
    {
      name: packageName,
      price: foundation?.price ?? 3500,
      billing: "one-time",
    },
  ];
}

function calculateTotals(services: ProposalService[]): {
  total_one_time: number;
  total_monthly: number;
} {
  let total_one_time = 0;
  let total_monthly = 0;
  for (const s of services) {
    if (s.billing === "one-time") total_one_time += s.price;
    else if (s.billing === "monthly") total_monthly += s.price;
  }
  return { total_one_time, total_monthly };
}

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
    .select("id, business_name, niche, category, website")
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
  const services = buildDefaultServices(pkg, price_mode);
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
