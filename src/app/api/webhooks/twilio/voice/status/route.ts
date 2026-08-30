// Twilio Voice status callback.
//
// Public endpoint authenticated by the X-Twilio-Signature HMAC, like the
// inbound SMS webhook. It is the only writer of a call's outcome: an agent has
// no UPDATE policy on voice_calls, so ringing, answered, completed, busy and
// failed all arrive here or not at all.
//
// What it deliberately does not touch: leads.lifecycle_status,
// leads.assigned_to, leads.contacted_at, and anything in the revenue tables.
// A phone that rang is not a conversation and is certainly not a commission
// event. The only lead-adjacent write is an activity_log row naming what
// happened, which is the record §16 asks for without the lifecycle change it
// forbids.

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { readVoiceConfig, reconstructWebhookUrl } from "@/lib/voice/config";
import { verifyTwilioSignature } from "@/lib/sms/signature";
import { buildEmptyTwiml } from "@/lib/voice/twiml";
import type { VoiceCallStatus } from "@/lib/leads/types";

export const runtime = "nodejs";

/**
 * Twilio's CallStatus vocabulary mapped onto ours.
 *
 * `queued` and `initiated` both mean "Twilio has it, nothing has rung yet".
 * Anything not listed is ignored rather than guessed at — writing an unknown
 * value would fail the column's CHECK and lose the update entirely.
 */
const STATUS_MAP: Record<string, VoiceCallStatus> = {
  queued: "initiated",
  initiated: "initiated",
  ringing: "ringing",
  answered: "in-progress",
  "in-progress": "in-progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no-answer",
  failed: "failed",
  canceled: "canceled",
};

const TERMINAL = new Set<VoiceCallStatus>([
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);

/**
 * Statuses that must not be walked backwards. Twilio retries and can deliver
 * events out of order, and a late `ringing` arriving after `completed` would
 * otherwise reopen a finished call.
 */
const RANK: Record<VoiceCallStatus, number> = {
  requested: 0,
  disabled: 0,
  initiated: 1,
  ringing: 2,
  "in-progress": 3,
  completed: 4,
  busy: 4,
  "no-answer": 4,
  failed: 4,
  canceled: 4,
};

function twiml(): NextResponse {
  // 200 with empty TwiML: Twilio retries non-2xx, and there is nothing it
  // could usefully do differently on a second attempt.
  return new NextResponse(buildEmptyTwiml(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const config = readVoiceConfig();

    let formText: string;
    try {
      formText = await request.text();
    } catch {
      console.error("[twilio/voice/status] failed to read body");
      return twiml();
    }

    const params: Record<string, string> = {};
    try {
      for (const [k, v] of new URLSearchParams(formText)) params[k] = v;
    } catch {
      console.error("[twilio/voice/status] failed to parse form body");
      return twiml();
    }

    // --- Signature validation ------------------------------------------
    if (config.validateSignature) {
      if (!config.authToken) {
        console.error("[twilio/voice/status] TWILIO_AUTH_TOKEN missing; cannot validate signature");
        return twiml();
      }
      const signature = request.headers.get("x-twilio-signature");
      if (!signature) {
        console.warn("[twilio/voice/status] missing X-Twilio-Signature header");
        return twiml();
      }
      const url = reconstructWebhookUrl(request.headers, request.url);
      if (!verifyTwilioSignature(config.authToken, url, params, signature)) {
        console.warn("[twilio/voice/status] signature mismatch", { url });
        return twiml();
      }
    }

    const callSid = params.CallSid ?? null;
    const rawStatus = params.CallStatus ?? "";
    const mapped = STATUS_MAP[rawStatus];
    if (!mapped) {
      console.warn("[twilio/voice/status] unrecognised CallStatus", { rawStatus });
      return twiml();
    }

    const token = new URL(request.url).searchParams.get("token");
    // Generic client for the same reason as the Stripe and bridge webhooks —
    // no generated Database type, so the narrow inference types writes `never`.
    const supabase = createServiceClient() as unknown as SupabaseClient;

    // Which call this is about.
    //
    // The token is the stronger binding of the two: it is unique to one call,
    // it is part of the URL Twilio signed, and it is already stored when the
    // call is created — whereas the SID only lands once Twilio's create-call
    // response comes back, which the first status callback can beat.
    //
    // So: match on the token, cross-check the SID, and fall back to the SID
    // only when there is no token to go on.
    const COLUMNS =
      "id, status, twilio_call_sid, lead_id, agent_id, answered_at, completed_at";

    type CallRow = {
      id: string;
      status: VoiceCallStatus;
      twilio_call_sid: string | null;
      lead_id: string;
      agent_id: string;
      answered_at: string | null;
      completed_at: string | null;
    };

    let call: CallRow | null = null;

    if (token) {
      const { data } = await supabase
        .from("voice_calls")
        .select(COLUMNS)
        .eq("bridge_token", token)
        .maybeSingle<CallRow>();
      call = data ?? null;

      // A token names exactly one call. If that call already carries a
      // different SID, this callback is not about it, and writing the update
      // anyway would corrupt a call with another call's outcome.
      if (call && callSid && call.twilio_call_sid && call.twilio_call_sid !== callSid) {
        console.warn("[twilio/voice/status] token and CallSid disagree; ignoring", {
          callSid,
        });
        return twiml();
      }
    }

    if (!call && callSid) {
      const { data } = await supabase
        .from("voice_calls")
        .select(COLUMNS)
        .eq("twilio_call_sid", callSid)
        .maybeSingle<CallRow>();
      call = data ?? null;
    }

    if (!call) {
      // A status for a call we have no record of. Nothing to update, and
      // nothing to create — a row invented from a webhook would have no lead.
      console.warn("[twilio/voice/status] no matching call record", { callSid });
      return twiml();
    }

    // Out-of-order delivery: never walk a call backwards, and never reopen a
    // terminal one. A duplicate of the same status is a harmless no-op.
    if (RANK[mapped] < RANK[call.status] || TERMINAL.has(call.status)) {
      console.info("[twilio/voice/status] ignoring out-of-order status", {
        from: call.status,
        to: mapped,
      });
      return twiml();
    }

    const now = new Date().toISOString();
    const durationRaw = params.CallDuration ?? params.Duration ?? null;
    const duration = durationRaw !== null ? Number.parseInt(durationRaw, 10) : NaN;

    const patch: Record<string, unknown> = {
      status: mapped,
      // Twilio may only reveal the SID on the callback when we matched by token.
      twilio_call_sid: call.twilio_call_sid ?? callSid,
    };

    if (mapped === "in-progress" && !call.answered_at) patch.answered_at = now;
    if (TERMINAL.has(mapped)) {
      patch.completed_at = call.completed_at ?? now;
      if (Number.isFinite(duration) && duration >= 0) patch.duration_seconds = duration;
    }
    if (mapped === "failed") {
      // Twilio sends these only on failures; they are the actual reason.
      const code = params.ErrorCode ?? null;
      const message = params.ErrorMessage ?? null;
      if (code || message) {
        patch.error_message = [code ? `Twilio error ${code}` : null, message]
          .filter(Boolean)
          .join(": ");
      }
    }

    // Scoped to this one row by primary key. A status callback can never touch
    // a call other than its own.
    const { error: updateError } = await supabase
      .from("voice_calls")
      .update(patch)
      .eq("id", call.id);

    if (updateError) {
      console.error("[twilio/voice/status] update failed", updateError);
      return twiml();
    }

    // One activity row per finished call, describing the outcome and nothing
    // more. lifecycle_status stays exactly where it was.
    if (TERMINAL.has(mapped)) {
      const connected = mapped === "completed" && Number.isFinite(duration) && duration > 0;
      const { error: logError } = await supabase.from("activity_log").insert({
        lead_id: call.lead_id,
        module: "leads",
        action: connected ? "lead.call_connected" : "lead.call_not_connected",
        entity_type: "lead",
        entity_id: call.lead_id,
        details: {
          agent_id: call.agent_id,
          voice_call_id: call.id,
          channel: "twilio_voice",
          status: mapped,
          duration_seconds: Number.isFinite(duration) ? duration : null,
          twilio_call_sid: call.twilio_call_sid ?? callSid,
        },
      });
      if (logError) console.error("[twilio/voice/status] activity log failed", logError);
    }

    return twiml();
  } catch (err) {
    console.error("[twilio/voice/status] unhandled error", err);
    return twiml();
  }
}
