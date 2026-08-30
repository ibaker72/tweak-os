// Server-only Twilio Voice configuration.
//
// IMPORTANT: never import this from a client component. Every value here comes
// from a server-side env var and none of them are prefixed NEXT_PUBLIC_, so
// they would be undefined in the browser anyway.
//
// Voice reuses the SMS account credentials — same Twilio account, same
// TWILIO_FROM_NUMBER — but it does NOT reuse the messaging service SID, which
// is a Messaging API concept with no meaning on the Calls API, and it does not
// reuse SMS_SENDING_ENABLED. The two channels are gated independently on
// purpose: A2P campaign approval and voice billing are unrelated events, and
// coupling them would mean turning one on turns the other on by accident.

export interface VoiceConfig {
  accountSid: string | null;
  authToken: string | null;
  /** The Twilio number. Must be voice-capable, and is the prospect's caller ID. */
  fromNumber: string | null;
  /** TWILIO_VOICE_ENABLED. Default false — no Twilio call is made while false. */
  voiceEnabled: boolean;
  /** Shared with the SMS webhook: TWILIO_WEBHOOK_VALIDATE_SIGNATURE. */
  validateSignature: boolean;
}

export function readVoiceConfig(): VoiceConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? null,
    authToken: process.env.TWILIO_AUTH_TOKEN ?? null,
    fromNumber: process.env.TWILIO_FROM_NUMBER ?? null,
    // Opt-in, and only to the exact string "true". Anything else — unset,
    // "1", "TRUE", a typo — leaves voice off, which is the safe direction.
    voiceEnabled: process.env.TWILIO_VOICE_ENABLED === "true",
    validateSignature: process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE !== "false",
  };
}

export function isVoiceEnabled(): boolean {
  return process.env.TWILIO_VOICE_ENABLED === "true";
}

/**
 * Why the config is unusable for a live call, or null when it is fine.
 *
 * Checked at the call site rather than at module load: the app has to boot and
 * the lead page has to render with voice unconfigured, showing a clear reason
 * instead of a stack trace.
 */
export function voiceConfigProblem(config: VoiceConfig): string | null {
  if (!config.accountSid || !config.authToken) {
    return "Twilio credentials missing: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for voice calling.";
  }
  if (!config.fromNumber) {
    return "Twilio caller ID missing: TWILIO_FROM_NUMBER is required for voice calling.";
  }
  return null;
}

/**
 * The public origin Twilio should call back on.
 *
 * Twilio fetches the TwiML and posts status updates from the internet, so this
 * has to be the externally reachable origin, not whatever host the request
 * object happens to carry behind Vercel's proxy. Prefer an explicit
 * APP_BASE_URL when set; otherwise reconstruct from the forwarded headers,
 * which is the same reconstruction the webhook signature check performs.
 */
export function resolveCallbackBaseUrl(headers: Headers, requestUrl: string): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const url = new URL(requestUrl);
  const proto = headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/**
 * The URL Twilio signed, reconstructed for signature validation.
 *
 * Twilio signs the URL it actually requested — which is the URL we handed it,
 * so it is built from the same origin resolveCallbackBaseUrl() produces.
 * Behind a proxy the request object reports the internal host, so validating
 * against `request.url` directly would reject every legitimate webhook.
 */
export function reconstructWebhookUrl(headers: Headers, requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${resolveCallbackBaseUrl(headers, requestUrl)}${url.pathname}${url.search}`;
}
