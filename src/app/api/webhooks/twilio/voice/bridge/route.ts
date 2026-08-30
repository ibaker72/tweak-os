// Twilio Voice bridge — the second leg of a click-to-call.
//
// Twilio fetches this the moment the agent picks up, and whatever TwiML comes
// back is what dials the prospect. Two things therefore have to be true:
//
//   1. Only Twilio can reach it. Enforced by the X-Twilio-Signature HMAC, the
//      same mechanism the inbound SMS webhook uses. There is no session here —
//      the caller is a machine.
//   2. The number dialed comes out of the database, never out of the request.
//      The URL carries an opaque per-call token; the prospect's number is read
//      from the voice_calls row that token identifies. A request that named a
//      number directly would be an open dialer wearing our caller ID.
//
// The token is not a secret in the credential sense — the signature is what
// authenticates — but it is unguessable and single-purpose, and it is signed
// as part of the URL, so a tampered one fails validation before it is read.
//
// No <Record> is ever emitted. This phase does not record calls.

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { readVoiceConfig, reconstructWebhookUrl } from "@/lib/voice/config";
import { verifyTwilioSignature } from "@/lib/sms/signature";
import { buildBridgeTwiml, buildRejectTwiml } from "@/lib/voice/twiml";

export const runtime = "nodejs";

/** A call record is only bridgeable this long after it was requested. */
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000;

/** Statuses a call can legitimately be in when the agent answers. */
const BRIDGEABLE = new Set(["requested", "initiated", "ringing", "in-progress"]);

function twiml(body: string): NextResponse {
  return new NextResponse(body, {
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
      console.error("[twilio/voice/bridge] failed to read body");
      return twiml(buildRejectTwiml());
    }

    const params: Record<string, string> = {};
    try {
      for (const [k, v] of new URLSearchParams(formText)) params[k] = v;
    } catch {
      console.error("[twilio/voice/bridge] failed to parse form body");
      return twiml(buildRejectTwiml());
    }

    // --- Signature validation ------------------------------------------
    if (config.validateSignature) {
      if (!config.authToken) {
        console.error("[twilio/voice/bridge] TWILIO_AUTH_TOKEN missing; cannot validate signature");
        return twiml(buildRejectTwiml());
      }
      const signature = request.headers.get("x-twilio-signature");
      if (!signature) {
        console.warn("[twilio/voice/bridge] missing X-Twilio-Signature header");
        return twiml(buildRejectTwiml());
      }
      const url = reconstructWebhookUrl(request.headers, request.url);
      if (!verifyTwilioSignature(config.authToken, url, params, signature)) {
        console.warn("[twilio/voice/bridge] signature mismatch", { url });
        return twiml(buildRejectTwiml());
      }
    }

    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      console.warn("[twilio/voice/bridge] no token on the callback URL");
      return twiml(buildRejectTwiml());
    }

    // Service role: there is no user session on a webhook, so there is no
    // RLS-bound client to use. The token is the whole authorisation.
    //
    // Cast to the generic client for the same reason the Stripe webhook does:
    // service.ts infers a narrow shape because no generated Database type is
    // wired up yet, which otherwise types every update() argument as `never`.
    const supabase = createServiceClient() as unknown as SupabaseClient;

    const { data: call, error } = await supabase
      .from("voice_calls")
      .select("id, status, prospect_phone, answered_at, created_at, lead_id, agent_id")
      .eq("bridge_token", token)
      .maybeSingle<{
        id: string;
        status: string;
        prospect_phone: string | null;
        answered_at: string | null;
        created_at: string;
        lead_id: string;
        agent_id: string;
      }>();

    if (error) {
      console.error("[twilio/voice/bridge] lookup failed", error);
      return twiml(buildRejectTwiml());
    }
    if (!call) {
      console.warn("[twilio/voice/bridge] no call record for token");
      return twiml(buildRejectTwiml());
    }

    // A finished call must not be re-bridged by a replayed request.
    if (!BRIDGEABLE.has(call.status)) {
      console.warn("[twilio/voice/bridge] call is not bridgeable", { status: call.status });
      return twiml(buildRejectTwiml());
    }

    if (Date.now() - new Date(call.created_at).getTime() > TOKEN_MAX_AGE_MS) {
      console.warn("[twilio/voice/bridge] token expired", { call_id: call.id });
      return twiml(buildRejectTwiml());
    }

    if (!call.prospect_phone) {
      console.warn("[twilio/voice/bridge] call record has no prospect number", { call_id: call.id });
      return twiml(buildRejectTwiml());
    }

    // The prospect's caller ID is the Twilio number, always. Never the agent's
    // own phone, and never anything the request suggested.
    if (!config.fromNumber) {
      console.error("[twilio/voice/bridge] TWILIO_FROM_NUMBER missing; refusing to dial");
      return twiml(buildRejectTwiml());
    }

    // Twilio fetching this URL means the agent picked up. That is the earliest
    // honest answer time we have for the first leg.
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("voice_calls")
      .update({
        status: "in-progress",
        answered_at: call.answered_at ?? now,
      })
      .eq("id", call.id);
    if (updateError) {
      // Log it, but still bridge: the agent is on the line and a bookkeeping
      // failure is not a reason to drop their call.
      console.error("[twilio/voice/bridge] failed to mark answered", updateError);
    }

    return twiml(
      buildBridgeTwiml({
        prospectPhone: call.prospect_phone,
        callerId: config.fromNumber,
      })
    );
  } catch (err) {
    console.error("[twilio/voice/bridge] unhandled error", err);
    return twiml(buildRejectTwiml());
  }
}
