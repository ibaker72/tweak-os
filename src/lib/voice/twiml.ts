// TwiML documents returned to Twilio.
//
// Built as strings rather than through a library: these are three fixed shapes
// and the only variable parts are two phone numbers that came out of the
// database. Everything interpolated goes through escapeXml anyway — a phone
// number should never contain a quote or an angle bracket, and the day one
// does is exactly the day this matters.

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

export interface BridgeTwimlOptions {
  /** The prospect's number, read from the call record — never from the request. */
  prospectPhone: string;
  /** TWILIO_FROM_NUMBER. The prospect must never see the agent's own phone. */
  callerId: string;
  /** Seconds to ring the prospect before giving up. */
  timeoutSeconds?: number;
}

/**
 * The bridge: the agent has answered, now dial the prospect.
 *
 * answerOnBridge="true" means the agent hears real ringing and the call is not
 * billed as answered until the prospect actually picks up.
 *
 * No <Record>, and no recording attribute on <Dial>. This phase does not
 * record calls.
 */
export function buildBridgeTwiml(options: BridgeTwimlOptions): string {
  const timeout = options.timeoutSeconds ?? 30;
  return (
    XML_HEADER +
    "<Response>" +
    `<Dial callerId="${escapeXml(options.callerId)}" timeout="${timeout}" answerOnBridge="true">` +
    `<Number>${escapeXml(options.prospectPhone)}</Number>` +
    "</Dial>" +
    "</Response>"
  );
}

/**
 * Said to the agent when the bridge cannot proceed — an unknown token, a call
 * record that is already finished, a lead whose number went missing.
 *
 * It says nothing about why: the agent is on a phone line, and the detail
 * belongs in the call record, not spoken aloud to whoever picked up.
 */
export function buildRejectTwiml(
  message = "This call could not be connected. Please try again from Tweak OS."
): string {
  return (
    XML_HEADER +
    "<Response>" +
    `<Say voice="alice">${escapeXml(message)}</Say>` +
    "<Hangup/>" +
    "</Response>"
  );
}

/** Acknowledge and do nothing — the status callback's reply. */
export function buildEmptyTwiml(): string {
  return XML_HEADER + "<Response></Response>";
}
