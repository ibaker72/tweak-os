// Twilio inbound SMS webhook.
//
// Public endpoint — does NOT require an app session. Authentication relies
// on Twilio's HMAC signature when TWILIO_WEBHOOK_VALIDATE_SIGNATURE=true,
// which is the default.
//
// Twilio retries failed deliveries, so this handler tries hard not to
// crash on malformed payloads and never echoes raw exception details back
// to Twilio (which would leak into the public webhook logs).

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readSmsConfig } from "@/lib/sms/config";
import { verifyTwilioSignature } from "@/lib/sms/signature";
import { logSmsMessage, sendSms } from "@/lib/sms/service";
import { findLeadByPhone } from "@/lib/sms/queries";
import {
  HELP_REPLY_BODY,
  isHelpKeyword,
  isOptOutKeyword,
} from "@/lib/sms/templates";
import { logActivity } from "@/lib/leads/mutations";

export const runtime = "nodejs";

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twimlResponse(): NextResponse {
  return new NextResponse(TWIML_EMPTY, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function failClosed(): NextResponse {
  // Return a generic 200 with empty TwiML so Twilio doesn't retry — but
  // log internally so we can debug. We chose 200 over 4xx specifically to
  // avoid surfacing internal errors to Twilio's webhook UI.
  return twimlResponse();
}

export async function POST(request: NextRequest) {
  try {
    const config = readSmsConfig();

    // Twilio always sends application/x-www-form-urlencoded.
    let formText: string;
    try {
      formText = await request.text();
    } catch {
      console.error("[twilio/webhook] failed to read body");
      return failClosed();
    }

    const params: Record<string, string> = {};
    try {
      const usp = new URLSearchParams(formText);
      for (const [k, v] of usp) params[k] = v;
    } catch {
      console.error("[twilio/webhook] failed to parse form body");
      return failClosed();
    }

    // --- Signature validation -----------------------------------------
    if (config.validateSignature) {
      if (!config.authToken) {
        console.error("[twilio/webhook] TWILIO_AUTH_TOKEN missing; cannot validate signature");
        return failClosed();
      }
      const signature = request.headers.get("x-twilio-signature");
      if (!signature) {
        console.warn("[twilio/webhook] missing X-Twilio-Signature header");
        return failClosed();
      }
      // Twilio signs against the URL it called — respect x-forwarded-* so
      // signature validation works behind Vercel's edge proxy.
      const forwardedProto =
        request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
      const forwardedHost =
        request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
      const pathAndQuery = new URL(request.url).pathname + new URL(request.url).search;
      const reconstructedUrl = `${forwardedProto}://${forwardedHost}${pathAndQuery}`;

      const ok = verifyTwilioSignature(config.authToken, reconstructedUrl, params, signature);
      if (!ok) {
        console.warn("[twilio/webhook] signature mismatch", {
          reconstructedUrl,
        });
        return failClosed();
      }
    }

    const fromNumber = params.From ?? null;
    const toNumber = params.To ?? null;
    const body = params.Body ?? "";
    const twilioSid = params.MessageSid ?? params.SmsMessageSid ?? null;
    const twilioStatus = params.SmsStatus ?? params.MessageStatus ?? "received";

    const supabase = createServiceClient();

    // --- Match to lead if possible ------------------------------------
    let leadId: string | null = null;
    if (fromNumber) {
      try {
        const lead = await findLeadByPhone(supabase, fromNumber);
        if (lead) leadId = lead.id;
      } catch (err) {
        console.error("[twilio/webhook] findLeadByPhone failed", err);
      }
    }

    const receivedAt = new Date().toISOString();

    // --- Log the inbound message --------------------------------------
    try {
      await logSmsMessage({
        supabase,
        lead_id: leadId,
        direction: "inbound",
        status: "received",
        from_number: fromNumber,
        to_number: toNumber,
        body,
        twilio_message_sid: twilioSid,
        twilio_status: twilioStatus,
        received_at: receivedAt,
      });
    } catch (err) {
      console.error("[twilio/webhook] failed to log inbound message", err);
    }

    if (leadId) {
      await supabase
        .from("leads")
        .update({ last_sms_received_at: receivedAt } as never)
        .eq("id", leadId);
    }

    // --- Opt-out handling ---------------------------------------------
    if (isOptOutKeyword(body)) {
      if (leadId) {
        try {
          await supabase
            .from("leads")
            .update({ sms_status: "opted_out" } as never)
            .eq("id", leadId);
          await logActivity(supabase, leadId, "sms_opted_out", {
            from_number: fromNumber,
          });
        } catch (err) {
          console.error("[twilio/webhook] failed to mark opted_out", err);
        }
      }
      // Twilio's Advanced Opt-Out handles the auto-reply itself — we just
      // return an empty TwiML response to acknowledge.
      return twimlResponse();
    }

    // --- HELP handling ------------------------------------------------
    if (isHelpKeyword(body) && fromNumber) {
      if (config.sendingEnabled) {
        try {
          await sendSms(supabase, {
            to: fromNumber,
            body: HELP_REPLY_BODY,
            lead_id: leadId,
          });
        } catch (err) {
          console.error("[twilio/webhook] failed to send HELP reply", err);
        }
      } else {
        // Log the would-be reply so we have a record once sending is on.
        try {
          await logSmsMessage({
            supabase,
            lead_id: leadId,
            direction: "outbound",
            status: "disabled",
            from_number: config.fromNumber,
            to_number: fromNumber,
            body: HELP_REPLY_BODY,
            error_message: "HELP reply suppressed — SMS sending disabled",
          });
        } catch (err) {
          console.error("[twilio/webhook] failed to log suppressed HELP reply", err);
        }
      }
    }

    return twimlResponse();
  } catch (err) {
    console.error("[twilio/webhook] unhandled error", err);
    return failClosed();
  }
}
