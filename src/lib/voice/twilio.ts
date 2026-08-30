// Minimal Twilio Calls REST client — the voice counterpart to
// src/lib/sms/twilio.ts, and deliberately built the same way: one fetch to one
// documented endpoint rather than the full twilio SDK for a single POST.
// Server-side only; this never reaches the browser.

import { voiceConfigProblem, type VoiceConfig } from "./config";

export interface TwilioCallInput {
  /** Leg one: the agent's own phone. Twilio rings this first. */
  to: string;
  /** The Twilio number. Also the caller ID the prospect sees on leg two. */
  from: string;
  /** TwiML endpoint Twilio fetches once the agent answers. */
  url: string;
  /** Where Twilio posts lifecycle updates for this call. */
  statusCallback: string;
  /** Seconds to ring the agent before giving up. Twilio's own default is 60. */
  timeoutSeconds?: number;
}

export interface TwilioCallResult {
  sid: string;
  status: string;
}

/** An error carrying whatever Twilio told us, so the UI can show the real reason. */
export class TwilioVoiceError extends Error {
  readonly httpStatus: number;
  readonly twilioCode: number | null;

  constructor(message: string, httpStatus: number, twilioCode: number | null) {
    super(message);
    this.name = "TwilioVoiceError";
    this.httpStatus = httpStatus;
    this.twilioCode = twilioCode;
  }

  /**
   * True for the errors that mean "the account cannot place calls right now"
   * rather than "this particular call was wrong" — a suspended or unfunded
   * account, or bad credentials.
   *
   * 20003 authentication failed · 20005 account not active
   * 20429 too many requests   · 21606 the From number cannot make this call
   */
  get isAccountProblem(): boolean {
    if (this.httpStatus === 401 || this.httpStatus === 403) return true;
    return this.twilioCode !== null && [20003, 20005, 20429].includes(this.twilioCode);
  }
}

/**
 * POST to Twilio's Create Call endpoint.
 *
 * Note what is absent: no Record parameter. This phase does not record calls,
 * and Twilio only records when asked, so the safe behaviour is the default and
 * the way to keep it that way is to never send the parameter.
 *
 * Throws TwilioVoiceError on non-2xx so the caller can persist the real
 * message on the call record instead of a generic failure.
 */
export async function twilioCreateCall(
  config: VoiceConfig,
  input: TwilioCallInput
): Promise<TwilioCallResult> {
  const problem = voiceConfigProblem(config);
  if (problem) throw new Error(problem);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    config.accountSid as string
  )}/Calls.json`;

  const params = new URLSearchParams();
  params.set("To", input.to);
  params.set("From", input.from);
  // Twilio fetches this when the agent answers; its TwiML dials the prospect.
  params.set("Url", input.url);
  params.set("Method", "POST");
  params.set("StatusCallback", input.statusCallback);
  params.set("StatusCallbackMethod", "POST");
  // append, not set — Twilio reads StatusCallbackEvent as a repeated field.
  for (const event of ["initiated", "ringing", "answered", "completed"]) {
    params.append("StatusCallbackEvent", event);
  }
  params.set("Timeout", String(input.timeoutSeconds ?? 30));

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
    const code = typeof parsed.code === "number" ? parsed.code : null;
    throw new TwilioVoiceError(message, res.status, code);
  }

  return {
    sid: String(parsed.sid ?? ""),
    // Twilio's initial status for a freshly created call.
    status: String(parsed.status ?? "queued"),
  };
}
