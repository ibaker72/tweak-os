import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@/lib/leads/queries";
import { logActivity } from "@/lib/leads/mutations";
import {
  isSmsSendingEnabled,
  normalizePhoneNumber,
} from "@/lib/sms/config";
import { logSmsMessage, sendSms } from "@/lib/sms/service";
import type { SmsStatus } from "@/lib/leads/types";

export const runtime = "nodejs";

const sendBodySchema = z.object({
  lead_id: z.string().uuid(),
  body: z.string().max(1600),
  confirm_send: z.boolean().optional().default(false),
});

// In-process rate limiter — matches the OpenClaw guard pattern. SMS send is
// admin-only, so this exists purely as a guardrail against runaway clients.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimitKey(req: NextRequest, userId: string | null): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  return `${userId ?? ip}|/api/sms/send`;
}

function enforceRateLimit(key: string): NextResponse | null {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return NextResponse.json(
      { ok: false, status: "blocked", reason: "rate_limited", message: "Too many SMS requests. Try again shortly." },
      { status: 429 }
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // --- Auth: must be a signed-in admin/agent user --------------------
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, status: "blocked", reason: "unauthenticated", message: "Sign in required" },
        { status: 401 }
      );
    }

    const limited = enforceRateLimit(rateLimitKey(request, user.id));
    if (limited) return limited;

    // --- Parse body ----------------------------------------------------
    const json = await request.json().catch(() => null);
    if (!json) {
      return NextResponse.json(
        { ok: false, status: "blocked", reason: "invalid_body", message: "Invalid JSON body" },
        { status: 400 }
      );
    }
    const parsed = sendBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          status: "blocked",
          reason: "invalid_input",
          message: "Invalid input",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }
    const { lead_id, body, confirm_send } = parsed.data;

    // --- Look up lead ---------------------------------------------------
    const lead = await getLeadById(supabase, lead_id);
    if (!lead) {
      return NextResponse.json(
        { ok: false, status: "blocked", reason: "lead_not_found", message: "Lead not found" },
        { status: 404 }
      );
    }

    const trimmedBody = body.trim();
    const phone = lead.phone ?? lead.phone_1 ?? null;
    const normalizedPhone = normalizePhoneNumber(phone);

    const baseLog = {
      supabase,
      lead_id: lead.id,
      direction: "outbound" as const,
      from_number: null,
      to_number: normalizedPhone ?? phone ?? null,
      body: trimmedBody,
      created_by: null,
    };

    // --- Hard blocks (logged but never sent) ---------------------------
    if (!trimmedBody) {
      await logSmsMessage({
        ...baseLog,
        status: "blocked",
        error_message: "Message body is empty",
      });
      return NextResponse.json({
        ok: false,
        status: "blocked",
        reason: "empty_body",
        message: "Message body is empty.",
      });
    }

    if (!normalizedPhone) {
      await logSmsMessage({
        ...baseLog,
        status: "blocked",
        error_message: "Lead has no valid phone number",
      });
      return NextResponse.json({
        ok: false,
        status: "blocked",
        reason: "missing_phone",
        message: "Lead has no valid phone number.",
      });
    }

    const smsStatus = (lead.sms_status ?? "unknown") as SmsStatus;
    if (smsStatus === "opted_out") {
      await logSmsMessage({
        ...baseLog,
        status: "blocked",
        error_message: "Lead has opted out of SMS",
      });
      return NextResponse.json({
        ok: false,
        status: "blocked",
        reason: "opted_out",
        message: "This lead has opted out of SMS.",
      });
    }
    if (smsStatus === "do_not_contact") {
      await logSmsMessage({
        ...baseLog,
        status: "blocked",
        error_message: "Lead marked do_not_contact",
      });
      return NextResponse.json({
        ok: false,
        status: "blocked",
        reason: "do_not_contact",
        message: "This lead is marked do-not-contact.",
      });
    }

    if (!confirm_send) {
      await logSmsMessage({
        ...baseLog,
        status: "draft",
        error_message: "confirm_send was not true",
      });
      return NextResponse.json({
        ok: false,
        status: "draft",
        reason: "missing_confirmation",
        message: "confirm_send must be true to send this SMS.",
      });
    }

    // --- Disabled path: drop, log, no Twilio call ----------------------
    if (!isSmsSendingEnabled()) {
      await logSmsMessage({
        ...baseLog,
        status: "disabled",
        error_message: "SMS sending is disabled until Twilio A2P approval",
      });
      return NextResponse.json({
        ok: false,
        status: "disabled",
        reason: "disabled",
        message: "SMS sending is disabled until A2P approval.",
      });
    }

    // --- Live send -----------------------------------------------------
    const result = await sendSms(supabase, {
      to: normalizedPhone,
      body: trimmedBody,
      lead_id: lead.id,
    });

    if (result.ok) {
      await logActivity(supabase, lead.id, "sms_sent", {
        twilio_message_sid: result.twilio_message_sid,
      });
    }

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      reason: result.reason,
      message: result.ok
        ? "SMS queued for delivery."
        : result.error_message ?? "SMS send failed.",
      twilio_message_sid: result.twilio_message_sid,
    });
  } catch (err) {
    console.error("[sms/send] error:", err);
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        reason: "internal_error",
        message: "Internal error while sending SMS.",
      },
      { status: 500 }
    );
  }
}
