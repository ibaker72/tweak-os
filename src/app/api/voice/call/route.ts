import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { resolveCallbackBaseUrl } from "@/lib/voice/config";
import { initiateVoiceCall } from "@/lib/voice/service";

export const runtime = "nodejs";

/**
 * POST /api/voice/call — place a click-to-call for one lead.
 *
 * The body is one field, and `.strict()` is load-bearing: a request carrying
 * prospect_phone, agent_id, from_number or caller_id is rejected outright
 * rather than quietly ignored. Silent stripping would work too, but a 400
 * makes it obvious to whoever sent it that those fields were never an input.
 *
 * Everything that decides who gets dialed is resolved server-side, inside
 * request_voice_call(): the prospect's number comes from the lead row, the
 * agent's callback number from the caller's own profile, and the caller ID
 * from the environment at TwiML time. There is no path from this body to a
 * phone number.
 */
const callBodySchema = z
  .object({
    lead_id: z.string().uuid(),
  })
  .strict();

// Calling is one-lead-at-a-time by hand. This ceiling is not a throughput
// control, it is what stops a stuck client from dialing a phone repeatedly.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const buckets = new Map<string, { count: number; resetAt: number }>();

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
      {
        ok: false,
        reason: "rate_limited",
        message: "Too many call attempts. Wait a moment and try again.",
      },
      { status: 429 }
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  // Signed in and active. RLS then decides which leads are callable at all.
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const limited = enforceRateLimit(`${guard.agent.id}|/api/voice/call`);
    if (limited) return limited;

    const json = await request.json().catch(() => null);
    if (!json) {
      return NextResponse.json(
        { ok: false, reason: "invalid_body", message: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = callBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          reason: "invalid_input",
          message:
            "Invalid input. This endpoint accepts lead_id only — the phone numbers and caller ID are resolved server-side.",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const result = await initiateVoiceCall(guard.supabase, {
      leadId: parsed.data.lead_id,
      baseUrl: resolveCallbackBaseUrl(request.headers, request.url),
    });

    // A refused call is a normal outcome with a specific message, not a
    // server error — except a lead the caller cannot see, which is a 404 so
    // the client stops rather than retrying.
    const status = result.reason === "lead_not_found" ? 404 : 200;

    return NextResponse.json(
      {
        ok: result.ok,
        reason: result.reason,
        message: result.message,
        call_id: result.call_id,
        twilio_call_sid: result.twilio_call_sid,
        // Twilio's own words when it refused — a suspended account says so.
        // Safe to surface: it carries no credentials.
        error_message: result.error_message,
      },
      { status }
    );
  } catch (err) {
    console.error("[voice/call] error:", err);
    return NextResponse.json(
      {
        ok: false,
        reason: "internal_error",
        message: "Internal error while placing the call.",
      },
      { status: 500 }
    );
  }
}
