// Minimal Twilio REST client. We hit the Messages endpoint directly via
// fetch so we don't pull in the full twilio SDK for one call. This file is
// only loaded inside server-side code paths and never reaches the browser.

import { assertSendableConfig, type SmsConfig } from "./config";

export interface TwilioSendInput {
  to: string;
  body: string;
}

export interface TwilioSendResult {
  sid: string;
  status: string;
}

/**
 * POST to Twilio's Create Message endpoint. Prefers MessagingServiceSid
 * when configured; falls back to a raw From number otherwise.
 *
 * Throws on non-2xx so the caller can log the error message and mark the
 * message row as failed.
 */
export async function twilioCreateMessage(
  config: SmsConfig,
  input: TwilioSendInput
): Promise<TwilioSendResult> {
  assertSendableConfig(config);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    config.accountSid
  )}/Messages.json`;

  const params = new URLSearchParams();
  params.set("To", input.to);
  params.set("Body", input.body);

  if (config.messagingServiceSid) {
    params.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (config.fromNumber) {
    params.set("From", config.fromNumber);
  }

  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    const message =
      (typeof parsed.message === "string" && parsed.message) ||
      `Twilio API returned ${res.status}`;
    throw new Error(message);
  }

  return {
    sid: String(parsed.sid ?? ""),
    status: String(parsed.status ?? "queued"),
  };
}
