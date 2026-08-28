import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  computeSignature,
  extractCharge,
  parseSignatureHeader,
  verifyStripeSignature,
} from "./signature";

const SECRET = "whsec_testsecret";
const BODY = '{"id":"evt_1","type":"charge.succeeded"}';
const NOW = 1_700_000_000;

function signedHeader(
  body = BODY,
  timestamp = NOW,
  secret = SECRET
): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

describe("parseSignatureHeader", () => {
  it("pulls the timestamp and signature out", () => {
    const parsed = parseSignatureHeader("t=1614556800,v1=abc123");
    expect(parsed).toEqual({ timestamp: 1614556800, signatures: ["abc123"] });
  });

  it("collects every v1 signature, as sent during secret rotation", () => {
    const parsed = parseSignatureHeader("t=1,v1=aaa,v1=bbb");
    expect(parsed?.signatures).toEqual(["aaa", "bbb"]);
  });

  it("ignores the legacy v0 scheme", () => {
    const parsed = parseSignatureHeader("t=1,v0=old,v1=new");
    expect(parsed?.signatures).toEqual(["new"]);
  });

  it("returns null without a timestamp or without any signature", () => {
    expect(parseSignatureHeader("v1=abc")).toBeNull();
    expect(parseSignatureHeader("t=1")).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
    expect(parseSignatureHeader("garbage")).toBeNull();
  });
});

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        signatureHeader: signedHeader(),
        secret: SECRET,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: true });
  });

  it("rejects a body that was altered after signing", () => {
    const result = verifyStripeSignature({
      rawBody: '{"id":"evt_1","type":"charge.succeeded","amount":999999}',
      signatureHeader: signedHeader(),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("rejects a signature made with a different secret", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      signatureHeader: signedHeader(BODY, NOW, "whsec_wrong"),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("rejects a replayed request outside the tolerance window", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      signatureHeader: signedHeader(BODY, NOW - 3600),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects a timestamp far in the future, which would otherwise never expire", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      signatureHeader: signedHeader(BODY, NOW + 86_400),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("accepts a request just inside the tolerance", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      signatureHeader: signedHeader(BODY, NOW - 299),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("passes when any one of several rotated signatures matches", () => {
    const good = computeSignature(BODY, NOW, SECRET);
    const result = verifyStripeSignature({
      rawBody: BODY,
      signatureHeader: `t=${NOW},v1=deadbeef,v1=${good}`,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("fails closed when the endpoint secret is not configured", () => {
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        signatureHeader: signedHeader(),
        secret: undefined,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: false, reason: "no_secret" });
  });

  it("fails closed when the header is missing or malformed", () => {
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        signatureHeader: null,
        secret: SECRET,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: false, reason: "missing_header" });

    expect(
      verifyStripeSignature({
        rawBody: BODY,
        signatureHeader: "nonsense",
        secret: SECRET,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: false, reason: "malformed_header" });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on mismatched lengths; this must not surface.
    const result = verifyStripeSignature({
      rawBody: BODY,
      signatureHeader: `t=${NOW},v1=short`,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("is sensitive to whitespace, which is why the route must not re-serialise", () => {
    const header = signedHeader(BODY, NOW);
    const reserialised = JSON.stringify(JSON.parse(BODY)) + " ";
    expect(
      verifyStripeSignature({
        rawBody: reserialised,
        signatureHeader: header,
        secret: SECRET,
        nowSeconds: NOW,
      }).ok
    ).toBe(false);
  });
});

describe("extractCharge", () => {
  function chargeEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: "evt_1",
      type: "charge.succeeded",
      created: NOW,
      data: {
        object: {
          id: "ch_1",
          object: "charge",
          amount: 850_000,
          currency: "usd",
          created: NOW,
          payment_intent: "pi_1",
          metadata: { deal_id: "11111111-1111-1111-1111-111111111111" },
          ...overrides,
        },
      },
    };
  }

  it("pulls the ledger fields out of a charge", () => {
    const result = extractCharge(chargeEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.chargeId).toBe("ch_1");
    expect(result.paymentIntentId).toBe("pi_1");
    expect(result.amountCents).toBe(850_000);
    expect(result.dealId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.currency).toBe("usd");
    expect(result.receivedAt).toBe(new Date(NOW * 1000).toISOString());
  });

  it("treats Stripe amounts as cents without conversion", () => {
    // Stripe sends the smallest currency unit already. Dividing or multiplying
    // here would be a hundredfold error in someone's commission.
    const result = extractCharge(chargeEvent({ amount: 1 }));
    expect(result.ok && result.amountCents).toBe(1);
  });

  it("reports a missing deal_id rather than guessing", () => {
    const result = extractCharge(chargeEvent({ metadata: {} }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dealId).toBeNull();
  });

  it("carries the refunded amount through", () => {
    const result = extractCharge(
      chargeEvent({ amount_refunded: 200_000, refunded: false })
    );
    expect(result.ok && result.refundedCents).toBe(200_000);
  });

  it("defaults refunded to zero when absent", () => {
    const result = extractCharge(chargeEvent());
    expect(result.ok && result.refundedCents).toBe(0);
  });

  it("rejects a non-charge object", () => {
    const result = extractCharge({
      id: "evt_2",
      type: "customer.created",
      created: NOW,
      data: { object: { id: "cus_1", object: "customer" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expected a charge/);
  });

  it("rejects a malformed envelope rather than throwing", () => {
    expect(extractCharge(null).ok).toBe(false);
    expect(extractCharge({}).ok).toBe(false);
    expect(extractCharge({ data: {} }).ok).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    const result = extractCharge(chargeEvent({ amount: 100.5 }));
    expect(result.ok).toBe(false);
  });
});
