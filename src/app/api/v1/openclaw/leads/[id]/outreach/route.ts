import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { logOpenClawAction } from "@/lib/openclaw/activity";
import { getLeadById } from "@/lib/leads/queries";
import { updateLeadOutreach } from "@/lib/leads/mutations";
import { generateOpenClawOutreach } from "@/lib/openclaw/outreach";
import type { OutreachData } from "@/lib/leads/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z
  .object({
    tone: z.string().max(60).optional(),
    offer: z.string().max(120).optional(),
    channel: z.string().max(60).optional(),
  })
  .partial()
  .default({});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = guard(request);
  if (!check.ok) return check.response;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Outreach generation is not configured (missing ANTHROPIC_API_KEY)" },
      { status: 503 }
    );
  }

  const { id } = await params;

  let body: unknown = {};
  if (request.headers.get("content-length") && request.headers.get("content-length") !== "0") {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const lead = await getLeadById(supabase, id);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  let outreach;
  try {
    outreach = await generateOpenClawOutreach(lead, parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Outreach generation failed";
    console.error("[openclaw] outreach error:", msg);
    await logOpenClawAction(supabase, id, "outreach.failed", { error: msg });
    return NextResponse.json({ error: "Outreach generation failed" }, { status: 502 });
  }

  // Persist to leads.outreach so the existing UI cards render it without
  // any extra translation. Map the OpenClaw shape onto the in-app
  // OutreachData type — the API response keeps the original shape.
  const persisted: OutreachData = {
    pain_points: outreach.pain_points,
    offer_angle: outreach.offer_angle,
    cold_email: outreach.email_body
      ? outreach.email_subject
        ? `Subject: ${outreach.email_subject}\n\n${outreach.email_body}`
        : outreach.email_body
      : "",
    follow_up_email: outreach.follow_up_email,
    sms: outreach.sms,
    call_opener: outreach.cold_call_opener,
    linkedin_dm: "",
    pricing_tier: parsed.data.offer || "New Business Launch Kit",
  };

  try {
    await updateLeadOutreach(supabase, id, persisted);
  } catch (err) {
    // Don't fail the response just because persistence failed.
    console.error("[openclaw] outreach persist failed:", err);
  }

  await logOpenClawAction(supabase, id, "outreach.generated", {
    tone: parsed.data.tone ?? "professional",
    offer: parsed.data.offer ?? "New Business Launch Kit",
    channel: parsed.data.channel ?? "email_sms_call",
    next_best_action: outreach.next_best_action,
  });

  return NextResponse.json(outreach);
}
