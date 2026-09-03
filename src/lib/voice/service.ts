// Click-to-call orchestration.
//
// The order of operations is the design. A call record exists in the database
// before Twilio is contacted, and Twilio is handed an opaque token pointing at
// that record — so the number Twilio eventually dials is read back out of the
// row rather than carried through the request. Nothing in this file ever takes
// a phone number from a caller: `leadId` is the entire input.
//
// Every exit writes to the record. A suppressed call, a misconfiguration and a
// Twilio rejection are all outcomes worth having in the history, and an
// attempt that vanished because it failed is the one you most want later.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  callbackBaseUrlProblem,
  readVoiceConfig,
  voiceConfigProblem,
  type VoiceConfig,
} from "./config";
import { twilioCreateCall, TwilioVoiceError } from "./twilio";

export type InitiateCallReason =
  | "calling"
  | "disabled"
  | "not_configured"
  | "lead_not_found"
  | "lead_do_not_contact"
  | "agent_phone_missing"
  | "lead_phone_missing"
  | "same_number"
  | "twilio_error";

export interface InitiateCallResult {
  ok: boolean;
  reason: InitiateCallReason;
  /** Shown to the agent as-is. */
  message: string;
  call_id: string | null;
  twilio_call_sid: string | null;
  /** Twilio's own words, for the failure detail. Null unless something failed. */
  error_message: string | null;
}

export interface InitiateCallInput {
  leadId: string;
  /** Public origin Twilio will call back on, e.g. https://app.tweakandbuild.com */
  baseUrl: string;
}

export const VOICE_DISABLED_MESSAGE =
  "Twilio Voice is currently disabled. The call was not placed.";
export const AGENT_PHONE_MISSING_MESSAGE =
  "Add your callback phone number before using Twilio calling.";
export const LEAD_PHONE_MISSING_MESSAGE =
  "This lead has no valid phone number to call.";

/** Refusals request_voice_call() reports without creating a record. */
const REFUSAL_MESSAGES: Record<string, { reason: InitiateCallReason; message: string }> = {
  lead_not_found: {
    reason: "lead_not_found",
    message: "Lead not found or not assigned to you.",
  },
  lead_do_not_contact: {
    reason: "lead_do_not_contact",
    message: "This lead is marked do-not-contact.",
  },
  agent_phone_missing: {
    reason: "agent_phone_missing",
    message: AGENT_PHONE_MISSING_MESSAGE,
  },
  lead_phone_missing: {
    reason: "lead_phone_missing",
    message: LEAD_PHONE_MISSING_MESSAGE,
  },
  same_number: {
    reason: "same_number",
    message: "This lead's number is your own callback number.",
  },
};

interface RequestedCall {
  call_id: string;
  bridge_token: string;
  agent_phone: string;
  prospect_phone: string;
}

/** Close the record out. Never throws — a failed log must not mask the outcome. */
async function recordResult(
  supabase: SupabaseClient,
  callId: string,
  status: "initiated" | "disabled" | "failed",
  extra: { sid?: string | null; from?: string | null; error?: string | null } = {}
): Promise<void> {
  const { error } = await supabase.rpc("record_voice_call_result", {
    p_call_id: callId,
    p_status: status,
    p_twilio_call_sid: extra.sid ?? null,
    p_from_number: extra.from ?? null,
    p_error_message: extra.error ?? null,
  });
  if (error) console.error("[voice] failed to record call result", error);
}

export function bridgeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/twilio/voice/bridge?token=${encodeURIComponent(token)}`;
}

export function statusCallbackUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/twilio/voice/status?token=${encodeURIComponent(token)}`;
}

/**
 * Place a click-to-call for one lead, as the signed-in agent.
 *
 * `supabase` must be the request-scoped client, not the service-role one: the
 * definer function reads the caller's identity out of the JWT, and RLS is what
 * decides whether this lead is theirs to call.
 */
export async function initiateVoiceCall(
  supabase: SupabaseClient,
  input: InitiateCallInput,
  configOverride?: VoiceConfig
): Promise<InitiateCallResult> {
  const config = configOverride ?? readVoiceConfig();

  // --- Create the record. The database decides both numbers. ---------------
  const { data, error } = await supabase.rpc("request_voice_call", {
    p_lead_id: input.leadId,
  });
  if (error) throw error;

  const result = (data ?? {}) as Record<string, unknown>;

  if (result.ok !== true) {
    const refusal = REFUSAL_MESSAGES[String(result.reason ?? "")] ?? {
      reason: "lead_not_found" as const,
      message: "Lead not found or not assigned to you.",
    };
    return {
      ok: false,
      reason: refusal.reason,
      message: refusal.message,
      call_id: null,
      twilio_call_sid: null,
      error_message: null,
    };
  }

  const call: RequestedCall = {
    call_id: String(result.call_id),
    bridge_token: String(result.bridge_token),
    agent_phone: String(result.agent_phone),
    prospect_phone: String(result.prospect_phone),
  };

  // --- Kill switch. No Twilio call, but the attempt is still history. ------
  if (!config.voiceEnabled) {
    await recordResult(supabase, call.call_id, "disabled", {
      from: config.fromNumber,
      error: "TWILIO_VOICE_ENABLED is false — no call was placed",
    });
    return {
      ok: false,
      reason: "disabled",
      message: VOICE_DISABLED_MESSAGE,
      call_id: call.call_id,
      twilio_call_sid: null,
      error_message: null,
    };
  }

  // --- Enabled but not actually configured --------------------------------
  //
  // The base URL is part of the configuration here, not an implementation
  // detail: it is what Twilio fetches the bridge TwiML from, so a call placed
  // against an origin Twilio cannot reach rings the agent's phone and then
  // goes nowhere. Failing before the call is placed is the honest outcome.
  const problem = voiceConfigProblem(config) ?? callbackBaseUrlProblem(input.baseUrl);
  if (problem) {
    await recordResult(supabase, call.call_id, "failed", {
      from: config.fromNumber,
      error: problem,
    });
    return {
      ok: false,
      reason: "not_configured",
      message: "Twilio voice is enabled but not fully configured.",
      call_id: call.call_id,
      twilio_call_sid: null,
      error_message: problem,
    };
  }

  // --- Live call ----------------------------------------------------------
  try {
    const created = await twilioCreateCall(config, {
      to: call.agent_phone,
      from: config.fromNumber as string,
      url: bridgeUrl(input.baseUrl, call.bridge_token),
      statusCallback: statusCallbackUrl(input.baseUrl, call.bridge_token),
    });

    await recordResult(supabase, call.call_id, "initiated", {
      sid: created.sid,
      from: config.fromNumber,
    });

    return {
      ok: true,
      reason: "calling",
      // Accepted by Twilio is not connected, and the copy says so.
      message: "Calling your phone… Answer to connect to the prospect.",
      call_id: call.call_id,
      twilio_call_sid: created.sid,
      error_message: null,
    };
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : "Twilio rejected the call request";
    const accountProblem = err instanceof TwilioVoiceError && err.isAccountProblem;

    await recordResult(supabase, call.call_id, "failed", {
      from: config.fromNumber,
      error: detail,
    });

    return {
      ok: false,
      reason: "twilio_error",
      message: accountProblem
        ? "Twilio rejected the call — the account cannot place calls right now."
        : "Twilio could not place the call.",
      call_id: call.call_id,
      twilio_call_sid: null,
      error_message: detail,
    };
  }
}
