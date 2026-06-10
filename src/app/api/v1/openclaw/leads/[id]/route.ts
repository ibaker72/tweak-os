import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { logOpenClawAction } from "@/lib/openclaw/activity";
import { lifecycleStatusSchema } from "@/lib/validators/lead";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    lifecycle_status: lifecycleStatusSchema.optional(),
    priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    next_action: z.string().max(500).nullable().optional(),
    action_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "action_date must be YYYY-MM-DD")
      .nullable()
      .optional(),
    manual_score: z.number().int().min(0).max(100).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();

// PATCH-friendly translation from the OpenClaw vocabulary into actual
// `leads` columns. Anything outside this map is rejected by Zod before
// we get here, so the DB only sees fields we explicitly allow.
function buildUpdate(input: z.infer<typeof patchSchema>): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (input.lifecycle_status !== undefined) {
    update.lifecycle_status = input.lifecycle_status;
    if (input.lifecycle_status === "contacted") {
      update.contacted_at = new Date().toISOString();
    }
  }
  if (input.priority !== undefined) update.priority = input.priority;
  if (input.assigned_to !== undefined) {
    update.assigned_to = input.assigned_to;
    update.assigned_at = input.assigned_to ? new Date().toISOString() : null;
  }
  if (input.next_action !== undefined) update.next_action = input.next_action;
  if (input.action_date !== undefined) update.next_action_date = input.action_date;
  if (input.manual_score !== undefined) update.score = input.manual_score;
  if (input.notes !== undefined) update.manual_notes = input.notes;
  return update;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = guard(request);
  if (!check.ok) return check.response;

  const { id } = await params;
  const supabase = createServiceClient();

  const [leadRes, activityRes, sequencesRes, proposalsRes, auditsRes] =
    await Promise.all([
      supabase.from("leads").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("activity_log")
        .select("id, action, details, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("outreach_sequences")
        .select(
          "id, channel, sequence_step, subject, body, status, sent_at, scheduled_for, created_at"
        )
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("proposals")
        .select(
          "id, client_name, status, total_one_time, total_monthly, created_at, last_edited_at"
        )
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("lead_audits")
        .select("id, url, opportunity_grade, overall_score, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  if (leadRes.error) {
    console.error("[openclaw] lead detail error:", leadRes.error);
    return NextResponse.json({ error: "Failed to load lead" }, { status: 500 });
  }
  if (!leadRes.data) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const lead = leadRes.data as Record<string, unknown>;

  return NextResponse.json({
    ok: true,
    lead: {
      id: lead.id,
      business_info: {
        business_name: lead.business_name,
        industry: lead.niche ?? lead.category ?? null,
        category: lead.category ?? null,
        address: lead.address ?? null,
        city: lead.city ?? null,
        state: lead.state ?? null,
        zip: lead.zip ?? null,
        country: lead.country ?? null,
        google_place_id: lead.google_place_id ?? null,
        google_rating: lead.google_rating ?? null,
        google_review_count: lead.google_review_count ?? null,
      },
      contact_info: {
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        website_url: lead.website ?? null,
        contact_page: lead.contact_page ?? null,
        social_links: lead.social_links ?? {},
      },
      source: {
        source: lead.source ?? null,
        external_id: lead.external_id ?? null,
        entity_type: lead.entity_type ?? null,
        entity_status: lead.entity_status ?? null,
        registered_agent: lead.registered_agent ?? null,
        source_filing_date: lead.source_filing_date ?? null,
        import_notes: lead.import_notes ?? null,
      },
      enrichment: {
        status: lead.enrichment_status ?? null,
        summary: lead.enrichment_summary ?? null,
        error: lead.enrichment_error ?? null,
        tech_stack: lead.tech_stack ?? [],
        has_ssl: lead.has_ssl ?? null,
        is_mobile_responsive: lead.is_mobile_responsive ?? null,
        has_blog: lead.has_blog ?? null,
        has_ecommerce: lead.has_ecommerce ?? null,
        page_load_time_ms: lead.page_load_time_ms ?? null,
        performance_grade: lead.performance_grade ?? null,
        contact_status: lead.contact_status ?? null,
        online_presence: lead.online_presence ?? null,
      },
      scoring: {
        score: lead.score ?? 0,
        score_breakdown: lead.score_breakdown ?? {},
        reasons: lead.reasons ?? [],
      },
      pipeline: {
        lifecycle_status: lead.lifecycle_status ?? null,
        priority: lead.priority ?? null,
        assigned_to: lead.assigned_to ?? null,
        assigned_at: lead.assigned_at ?? null,
        next_action: lead.next_action ?? null,
        action_date: lead.next_action_date ?? null,
        contacted_at: lead.contacted_at ?? null,
        last_contacted_via: lead.last_contacted_via ?? null,
        follow_up_count: lead.follow_up_count ?? 0,
      },
      outreach_draft: lead.outreach ?? null,
      notes: {
        manual_notes: lead.manual_notes ?? null,
        import_notes: lead.import_notes ?? null,
      },
      audits: auditsRes.data ?? [],
      outreach_history: sequencesRes.data ?? [],
      proposals: proposalsRes.data ?? [],
      activity_log: activityRes.data ?? [],
      created_at: lead.created_at,
      updated_at: lead.updated_at,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = guard(request);
  if (!check.ok) return check.response;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const update = buildUpdate(parsed.data);
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No supported fields supplied" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("leads")
    .update(update as unknown as never)
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[openclaw] lead update error:", error);
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  await logOpenClawAction(supabase, id, "lead.updated", parsed.data);

  return NextResponse.json({ ok: true, lead_id: id, updated_fields: Object.keys(update) });
}
