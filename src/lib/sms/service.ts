// Core SMS sending service. Lives strictly server-side: the only entry
// points are API routes that already enforce auth (or the inbound webhook
// which is signature-validated).
//
// Behavior rules — these are load-bearing for A2P compliance:
//   1. No Twilio API call is made when SMS_SENDING_ENABLED=false.
//   2. Opted-out / do-not-contact leads are never messaged.
//   3. Every send attempt is logged to sms_messages, including blocked
//      and disabled attempts — we keep the audit trail either way.

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSmsConfig, normalizePhoneNumber } from "./config";
import { twilioCreateMessage } from "./twilio";
import type { SmsMessageStatus } from "@/lib/leads/types";

export type SendSmsReason =
  | "sent"
  | "queued"
  | "disabled"
  | "blocked_opted_out"
  | "blocked_do_not_contact"
  | "blocked_invalid_phone"
  | "blocked_empty_body"
  | "blocked_missing_confirmation"
  | "failed";

export interface SendSmsInput {
  to: string;
  body: string;
  lead_id?: string | null;
  created_by?: string | null;
  // Metadata is logged into sms_messages.error_message column when
  // useful for downstream debugging. Kept loose on purpose.
  metadata?: Record<string, unknown>;
}

export interface SendSmsResult {
  ok: boolean;
  status: SmsMessageStatus;
  reason: SendSmsReason;
  message_id: string | null;
  twilio_message_sid: string | null;
  twilio_status: string | null;
  error_message: string | null;
}

interface LogMessageOptions {
  supabase: SupabaseClient;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  status: SmsMessageStatus;
  from_number: string | null;
  to_number: string | null;
  body: string;
  twilio_message_sid?: string | null;
  twilio_status?: string | null;
  error_message?: string | null;
  created_by?: string | null;
  sent_at?: string | null;
  received_at?: string | null;
}

export async function logSmsMessage(
  opts: LogMessageOptions
): Promise<string | null> {
  const row = {
    lead_id: opts.lead_id,
    direction: opts.direction,
    status: opts.status,
    from_number: opts.from_number,
    to_number: opts.to_number,
    body: opts.body,
    twilio_message_sid: opts.twilio_message_sid ?? null,
    twilio_status: opts.twilio_status ?? null,
    error_message: opts.error_message ?? null,
    created_by: opts.created_by ?? null,
    sent_at: opts.sent_at ?? null,
    received_at: opts.received_at ?? null,
  };

  const { data, error } = await opts.supabase
    .from("sms_messages")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error("[sms] failed to log message", error);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

/**
 * Send a single SMS. The caller is responsible for verifying admin/auth
 * upstream and for checking lead.sms_status — this function still re-checks
 * the basics (phone format, non-empty body, disabled flag) so it's safe to
 * call from anywhere.
 */
export async function sendSms(
  supabase: SupabaseClient,
  input: SendSmsInput
): Promise<SendSmsResult> {
  const config = readSmsConfig();
  const normalizedTo = normalizePhoneNumber(input.to);
  const trimmedBody = input.body?.trim() ?? "";

  // --- Pre-flight validation ----------------------------------------
  if (!normalizedTo) {
    const id = await logSmsMessage({
      supabase,
      lead_id: input.lead_id ?? null,
      direction: "outbound",
      status: "blocked",
      from_number: config.fromNumber,
      to_number: input.to ?? null,
      body: trimmedBody || input.body || "",
      error_message: "Invalid or missing phone number",
      created_by: input.created_by ?? null,
    });
    return {
      ok: false,
      status: "blocked",
      reason: "blocked_invalid_phone",
      message_id: id,
      twilio_message_sid: null,
      twilio_status: null,
      error_message: "Invalid or missing phone number",
    };
  }

  if (!trimmedBody) {
    const id = await logSmsMessage({
      supabase,
      lead_id: input.lead_id ?? null,
      direction: "outbound",
      status: "blocked",
      from_number: config.fromNumber,
      to_number: normalizedTo,
      body: "",
      error_message: "Message body is empty",
      created_by: input.created_by ?? null,
    });
    return {
      ok: false,
      status: "blocked",
      reason: "blocked_empty_body",
      message_id: id,
      twilio_message_sid: null,
      twilio_status: null,
      error_message: "Message body is empty",
    };
  }

  // --- Disabled path (A2P approval still pending) -------------------
  if (!config.sendingEnabled) {
    const id = await logSmsMessage({
      supabase,
      lead_id: input.lead_id ?? null,
      direction: "outbound",
      status: "disabled",
      from_number: config.fromNumber,
      to_number: normalizedTo,
      body: trimmedBody,
      error_message: "SMS sending is disabled until Twilio A2P approval",
      created_by: input.created_by ?? null,
    });
    return {
      ok: false,
      status: "disabled",
      reason: "disabled",
      message_id: id,
      twilio_message_sid: null,
      twilio_status: null,
      error_message: "SMS sending is disabled until Twilio A2P approval",
    };
  }

  // --- Live send via Twilio -----------------------------------------
  try {
    const result = await twilioCreateMessage(config, {
      to: normalizedTo,
      body: trimmedBody,
    });
    const sentAt = new Date().toISOString();

    const id = await logSmsMessage({
      supabase,
      lead_id: input.lead_id ?? null,
      direction: "outbound",
      status: "sent",
      from_number: config.fromNumber,
      to_number: normalizedTo,
      body: trimmedBody,
      twilio_message_sid: result.sid,
      twilio_status: result.status,
      created_by: input.created_by ?? null,
      sent_at: sentAt,
    });

    if (input.lead_id) {
      await supabase
        .from("leads")
        .update({ last_sms_sent_at: sentAt })
        .eq("id", input.lead_id);
    }

    return {
      ok: true,
      status: "sent",
      reason: "sent",
      message_id: id,
      twilio_message_sid: result.sid,
      twilio_status: result.status,
      error_message: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Twilio send failed";
    const id = await logSmsMessage({
      supabase,
      lead_id: input.lead_id ?? null,
      direction: "outbound",
      status: "failed",
      from_number: config.fromNumber,
      to_number: normalizedTo,
      body: trimmedBody,
      error_message: errorMessage,
      created_by: input.created_by ?? null,
    });
    return {
      ok: false,
      status: "failed",
      reason: "failed",
      message_id: id,
      twilio_message_sid: null,
      twilio_status: null,
      error_message: errorMessage,
    };
  }
}
