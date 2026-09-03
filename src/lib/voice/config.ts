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
  /**
   * The Twilio number. Must be voice-capable, and is the prospect's caller ID.
   *
   * TWILIO_VOICE_FROM_NUMBER when set, otherwise TWILIO_FROM_NUMBER. The
   * override exists because a number can be SMS-capable without being
   * voice-capable, and an account that has to use two numbers should not have
   * to break SMS to place a call. Nothing needs to be configured for it: with
   * the override unset the behaviour is exactly what it was.
   */
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
    fromNumber:
      process.env.TWILIO_VOICE_FROM_NUMBER?.trim() ||
      process.env.TWILIO_FROM_NUMBER?.trim() ||
      null,
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
    return "Twilio caller ID missing: TWILIO_FROM_NUMBER (or TWILIO_VOICE_FROM_NUMBER) is required for voice calling.";
  }
  return null;
}

/**
 * The public origin Twilio should call back on.
 *
 * Twilio fetches the TwiML and posts status updates from the internet, so this
 * has to be the externally reachable origin, not whatever host the request
 * object happens to carry behind Vercel's proxy.
 *
 * The order below is a trust order, not a convenience order. Whatever this
 * returns becomes the URL Twilio fetches TwiML from, and TwiML is what decides
 * which number gets dialed — so an origin an attacker can choose is an
 * attacker-supplied dialer wearing our caller ID. `x-forwarded-host` is a
 * request header: behind Vercel it is set by the platform, but it is the one
 * input here that a caller could conceivably influence, so it is the last
 * resort rather than the default.
 *
 *   1. APP_BASE_URL — set this in production.
 *   2. NEXT_PUBLIC_APP_URL — the same value under the name some deployments
 *      already use. Read server-side; nothing about it needs to be public.
 *   3. VERCEL_PROJECT_PRODUCTION_URL — injected by Vercel, not by the request.
 *   4. the forwarded headers — local development and self-hosting.
 */
export function resolveCallbackBaseUrl(headers: Headers, requestUrl: string): string {
  const configured =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : "");

  if (configured) return normalizeOrigin(configured);

  const url = new URL(requestUrl);
  const proto = headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** Add a scheme if the value was configured without one, and drop trailing slashes. */
function normalizeOrigin(value: string): string {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * Why Twilio would not be able to reach this origin, or null when it looks
 * fine. Checked before a call is placed rather than after Twilio fails.
 *
 * The common way to get this wrong is to place a call from `npm run dev`: the
 * callback URL then points at localhost, Twilio cannot fetch it, and the agent
 * hears their phone ring and then silence. Saying so up front is cheaper than
 * reading it out of a Twilio error log.
 */
export function callbackBaseUrlProblem(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return `Callback base URL is not a valid URL (${baseUrl}). Set APP_BASE_URL to the public origin, e.g. https://app.tweakandbuild.com`;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `Callback base URL must be http or https (got ${url.protocol}). Set APP_BASE_URL to the public origin.`;
  }

  const host = url.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    /^127\./.test(host) ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (isLoopback) {
    return `Twilio cannot reach ${url.origin}. Set APP_BASE_URL to the public production origin, e.g. https://app.tweakandbuild.com`;
  }

  return null;
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
