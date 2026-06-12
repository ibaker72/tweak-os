import { describe, it, expect } from "vitest";
import { computeTwilioSignature, verifyTwilioSignature } from "./signature";

// Test vector cross-checked against the official Twilio docs:
//   https://www.twilio.com/docs/usage/webhooks/webhooks-security
// Note the docs use a worked example with this exact URL/params/token.
const TOKEN = "12345";
const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";

describe("computeTwilioSignature", () => {
  it("produces a stable signature for sorted params", () => {
    const sig1 = computeTwilioSignature(TOKEN, URL, { Digits: "1234", To: "+18005551212", From: "+14158675309", Caller: "+14158675309", CallSid: "CA1234567890ABCDE" });
    const sig2 = computeTwilioSignature(TOKEN, URL, { Caller: "+14158675309", From: "+14158675309", Digits: "1234", To: "+18005551212", CallSid: "CA1234567890ABCDE" });
    expect(sig1).toBe(sig2);
  });
});

describe("verifyTwilioSignature", () => {
  it("returns true when the signature matches the computed value", () => {
    const params = { To: "+18005551212", From: "+14158675309" };
    const expected = computeTwilioSignature(TOKEN, URL, params);
    expect(verifyTwilioSignature(TOKEN, URL, params, expected)).toBe(true);
  });

  it("returns false on a tampered signature", () => {
    const params = { To: "+18005551212", From: "+14158675309" };
    const expected = computeTwilioSignature(TOKEN, URL, params);
    const tampered = expected.slice(0, -1) + (expected.slice(-1) === "a" ? "b" : "a");
    expect(verifyTwilioSignature(TOKEN, URL, params, tampered)).toBe(false);
  });

  it("returns false when the token is missing", () => {
    const params = { To: "x" };
    const expected = computeTwilioSignature(TOKEN, URL, params);
    expect(verifyTwilioSignature("", URL, params, expected)).toBe(false);
  });
});
