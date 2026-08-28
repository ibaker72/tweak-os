import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";

/**
 * POST /api/my/actions — the inline actions on /my/queue.
 *
 * One endpoint for all of them because they share the same shape: touch a
 * lead, write an activity_log row. Every branch logs; a lead action that
 * leaves no trace is how a commission dispute becomes unanswerable.
 *
 * Nothing here filters by agent. The update either matches a row the caller's
 * RLS policy exposes or it matches nothing, and matching nothing is reported
 * as a 404 rather than a silent success.
 */

const LIFECYCLE = [
  "new",
  "enriched",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
  "not_a_fit",
] as const;

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("log_call"),
    lead_id: z.string().uuid(),
    note: z.string().max(2000).optional(),
    outcome: z.enum(["connected", "voicemail", "no_answer", "bad_number"]).optional(),
    follow_up_days: z.number().int().min(0).max(365).optional(),
  }),
  z.object({
    action: z.literal("log_email"),
    lead_id: z.string().uuid(),
    note: z.string().max(2000).optional(),
    subject: z.string().max(300).optional(),
    template_id: z.string().uuid().optional(),
    follow_up_days: z.number().int().min(0).max(365).optional(),
  }),
  z.object({
    action: z.literal("add_note"),
    lead_id: z.string().uuid(),
    note: z.string().min(1).max(4000),
  }),
  z.object({
    action: z.literal("set_next_action"),
    lead_id: z.string().uuid(),
    next_action: z.string().max(300).nullable(),
    next_action_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
  z.object({
    action: z.literal("advance_stage"),
    lead_id: z.string().uuid(),
    lifecycle_status: z.enum(LIFECYCLE),
  }),
]);

type Body = z.infer<typeof bodySchema>;

/** next_action_date `days` from now, as YYYY-MM-DD. */
function followUpDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const supabase = guard.supabase;

  try {
    // Confirm the lead is visible to this caller before doing anything. RLS
    // makes an unowned lead invisible, so this doubles as the ownership check.
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, business_name, lifecycle_status, next_action, next_action_date")
      .eq("id", body.lead_id)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!lead) {
      return NextResponse.json(
        { error: "Lead not found or not assigned to you" },
        { status: 404 }
      );
    }

    const patch = buildLeadPatch(body);
    if (Object.keys(patch).length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from("leads")
        .update(patch)
        .eq("id", body.lead_id)
        .select("id, lifecycle_status, next_action, next_action_date")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updated) {
        // RLS refused the write even though the read succeeded — an admin can
        // read every lead but an agent can only write their own.
        return NextResponse.json(
          { error: "You cannot modify this lead" },
          { status: 403 }
        );
      }
    }

    const { data: logged, error: logError } = await supabase
      .from("activity_log")
      .insert({
        lead_id: body.lead_id,
        module: "leads",
        action: activityAction(body),
        entity_type: "lead",
        entity_id: body.lead_id,
        details: activityDetails(body, guard.agent.id),
      })
      .select("id")
      .maybeSingle();

    if (logError) throw logError;

    // An email send is also a send-log row, tying the template used and the
    // activity_log entry it produced back to the lead.
    if (body.action === "log_email") {
      const { error: seqError } = await supabase.from("outreach_sequences").insert({
        lead_id: body.lead_id,
        agent_id: guard.agent.id,
        channel: "email",
        subject: body.subject ?? null,
        body: body.note ?? "",
        status: "sent",
        sent_at: new Date().toISOString(),
        template_id: body.template_id ?? null,
        activity_log_id: logged?.id ?? null,
      });
      // A failed send-log entry must not lose the activity record that already
      // succeeded, so this is reported rather than thrown.
      if (seqError) console.error("Send-log insert failed:", seqError.message);
    }

    const { data: fresh } = await supabase
      .from("leads")
      .select("id, lifecycle_status, next_action, next_action_date, contacted_at")
      .eq("id", body.lead_id)
      .maybeSingle();

    return NextResponse.json({ ok: true, lead: fresh ?? lead });
  } catch (err) {
    console.error("Lead action error:", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

function buildLeadPatch(body: Body): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  switch (body.action) {
    case "log_call":
    case "log_email": {
      // Logging outreach moves an untouched lead to contacted, but never walks
      // a further-along lead backwards.
      patch.contacted_at = new Date().toISOString();
      if (body.follow_up_days !== undefined) {
        patch.next_action_date = followUpDate(body.follow_up_days);
        patch.next_action =
          body.action === "log_call" ? "Follow up on call" : "Follow up on email";
      }
      break;
    }
    case "set_next_action": {
      patch.next_action = body.next_action;
      patch.next_action_date = body.next_action_date;
      break;
    }
    case "advance_stage": {
      patch.lifecycle_status = body.lifecycle_status;
      if (body.lifecycle_status === "contacted") {
        patch.contacted_at = new Date().toISOString();
      }
      break;
    }
    case "add_note":
      break;
  }

  return patch;
}

function activityAction(body: Body): string {
  switch (body.action) {
    case "log_call":
      return "lead.call_logged";
    case "log_email":
      return "lead.email_logged";
    case "add_note":
      return "lead.note_added";
    case "set_next_action":
      return "lead.next_action_set";
    case "advance_stage":
      return "lead.stage_advanced";
  }
}

function activityDetails(body: Body, agentId: string): Record<string, unknown> {
  const base: Record<string, unknown> = { agent_id: agentId };

  switch (body.action) {
    case "log_call":
      return { ...base, outcome: body.outcome ?? null, note: body.note ?? null };
    case "log_email":
      return {
        ...base,
        subject: body.subject ?? null,
        template_id: body.template_id ?? null,
        note: body.note ?? null,
      };
    case "add_note":
      return { ...base, note: body.note };
    case "set_next_action":
      return {
        ...base,
        next_action: body.next_action,
        next_action_date: body.next_action_date,
      };
    case "advance_stage":
      return { ...base, lifecycle_status: body.lifecycle_status };
  }
}
