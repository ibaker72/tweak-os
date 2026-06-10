import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@/lib/leads/queries";
import { updateLeadOutreach } from "@/lib/leads/mutations";
import { generateOpenClawOutreach } from "@/lib/openclaw/outreach";
import { logOpenClawAction } from "@/lib/openclaw/activity";
import type { OutreachData } from "@/lib/leads/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  lead_id: z.string().uuid(),
  tone: z.string().max(60).optional(),
  offer: z.string().max(120).optional(),
  channel: z.string().max(60).optional(),
});

/**
 * UI-facing wrapper for the OpenClaw outreach generator. The web UI is
 * already authenticated via Supabase session cookies, so we don't ask the
 * browser for a bearer token — the secret stays server-side.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Outreach generation is not configured (missing ANTHROPIC_API_KEY)" },
      { status: 503 }
    );
  }

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

  const { lead_id, ...opts } = parsed.data;
  const lead = await getLeadById(supabase, lead_id);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  let outreach;
  try {
    outreach = await generateOpenClawOutreach(lead, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Outreach generation failed";
    console.error("[openclaw-ui] outreach error:", msg);
    return NextResponse.json({ error: "Outreach generation failed" }, { status: 502 });
  }

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
    pricing_tier: opts.offer || "New Business Launch Kit",
  };

  try {
    await updateLeadOutreach(supabase, lead_id, persisted);
  } catch (err) {
    console.error("[openclaw-ui] outreach persist failed:", err);
  }

  await logOpenClawAction(supabase, lead_id, "ui.outreach.generated", {
    user_id: user.id,
    next_best_action: outreach.next_best_action,
  });

  return NextResponse.json({ ok: true, outreach });
}
