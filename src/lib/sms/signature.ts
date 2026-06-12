// Twilio webhook signature validation.
//
// Twilio signs each request with HMAC-SHA1 over the full URL plus the
// sorted POST params, base64-encoded. We implement this with `crypto`
// so we don't need the twilio SDK. See:
//   https://www.twilio.com/docs/usage/webhooks/webhooks-security

import crypto from "node:crypto";

/**
 * Computes the expected X-Twilio-Signature for a given URL + form params.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac("sha1", authToken).update(data).digest("base64");
}

/**
 * Returns true when the provided signature matches what Twilio would have
 * sent. Uses a constant-time comparison so attackers can't recover the
 * expected value via timing.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  if (!authToken || !signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
