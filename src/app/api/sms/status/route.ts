import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/leads/mutations";

export const runtime = "nodejs";

const smsStatusSchema = z.enum(["allowed", "opted_out", "do_not_contact", "unknown"]);

const updateBodySchema = z.object({
  lead_id: z.string().uuid(),
  sms_status: smsStatusSchema,
  confirm_opt_back_in: z.boolean().optional().default(false),
});

// PATCH /api/sms/status — admin-only SMS status control for a lead.
// Moving from opted_out to allowed requires confirm_opt_back_in=true.
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, message: "Sign in required" },
        { status: 401 }
      );
    }

    const json = await request.json().catch(() => null);
    if (!json) {
      return NextResponse.json(
        { ok: false, message: "Invalid JSON body" },
        { status: 400 }
      );
    }
    const parsed = updateBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { lead_id, sms_status, confirm_opt_back_in } = parsed.data;

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, sms_status")
      .eq("id", lead_id)
      .single();
    if (leadError || !lead) {
      return NextResponse.json(
        { ok: false, message: "Lead not found" },
        { status: 404 }
      );
    }

    if (lead.sms_status === "opted_out" && sms_status === "allowed" && !confirm_opt_back_in) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This lead previously opted out. Confirm they opted back in to receive SMS from Tweak & Build.",
          reason: "requires_opt_back_in_confirmation",
        },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabase
      .from("leads")
      .update({ sms_status })
      .eq("id", lead_id);
    if (updateError) throw updateError;

    await logActivity(supabase, lead_id, "sms_status_updated", {
      from: lead.sms_status,
      to: sms_status,
    });

    return NextResponse.json({ ok: true, sms_status });
  } catch (err) {
    console.error("[sms/status] error:", err);
    return NextResponse.json(
      { ok: false, message: "Internal error while updating SMS status" },
      { status: 500 }
    );
  }
}
