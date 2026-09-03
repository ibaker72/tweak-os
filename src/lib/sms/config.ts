// Server-only Twilio + SMS configuration helpers.
// IMPORTANT: this module must never be imported from a client component.
// All Twilio credentials are read from server-side env vars and would not
// be available in the browser anyway — they are not prefixed NEXT_PUBLIC_.

export interface SmsConfig {
  accountSid: string | null;
  authToken: string | null;
  messagingServiceSid: string | null;
  fromNumber: string | null;
  sendingEnabled: boolean;
  validateSignature: boolean;
}

export function readSmsConfig(): SmsConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? null,
    authToken: process.env.TWILIO_AUTH_TOKEN ?? null,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? null,
    fromNumber: process.env.TWILIO_FROM_NUMBER ?? null,
    sendingEnabled: process.env.SMS_SENDING_ENABLED === "true",
    // Default to validating signatures unless explicitly disabled.
    validateSignature: process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE !== "false",
  };
}

export function isSmsSendingEnabled(): boolean {
  return process.env.SMS_SENDING_ENABLED === "true";
}

// Throws when live sending is requested but required Twilio vars are missing.
// Called at the send call-site only, not at module load — we want the app
// to boot fine while the A2P campaign is still pending.
export function assertSendableConfig(config: SmsConfig): asserts config is SmsConfig & {
  accountSid: string;
  authToken: string;
} {
  if (!config.accountSid || !config.authToken) {
    throw new Error(
      "Twilio credentials missing: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required when SMS_SENDING_ENABLED=true."
    );
  }
  if (!config.messagingServiceSid && !config.fromNumber) {
    throw new Error(
      "Twilio sender missing: set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER when SMS_SENDING_ENABLED=true."
    );
  }
}

// Phone normalisation lives in @/lib/phone, which is also what the voice
// module and the Settings callback field use. Re-exported here so the existing
// `@/lib/sms/config` import sites keep working against one implementation
// rather than a second copy that can drift from it.
export { normalizePhoneNumber, isValidPhoneNumber } from "@/lib/phone";
