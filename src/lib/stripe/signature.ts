import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature verification — pure, no SDK.
 *
 * Stripe signs each webhook with a header of the form:
 *
 *   t=1614556800,v1=<hex hmac>,v1=<another>,v0=<legacy>
 *
 * where the signed payload is `${t}.${rawBody}` and the HMAC is SHA-256 keyed
 * on the endpoint secret. Multiple v1 signatures appear during secret
 * rotation, so any one matching is a pass.
 *
 * This is implemented rather than pulled from the SDK because it is the whole
 * of what the webhook needs, and it can then be unit-tested against known
 * vectors instead of mocked. The two things that actually matter are done
 * properly: constant-time comparison, and a timestamp tolerance so a captured
 * request cannot be replayed indefinitely.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "malformed_header" | "no_secret" | "timestamp_out_of_tolerance" | "no_matching_signature" };

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(header: string): ParsedHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === undefined || value === undefined) continue;
    const k = key.trim();
    if (k === "t") {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (k === "v1") {
      signatures.push(value.trim());
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function computeSignature(
  rawBody: string,
  timestamp: number,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, so length is checked first.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Stripe webhook.
 *
 * `rawBody` must be the exact bytes Stripe sent. Re-serialising parsed JSON
 * changes key order and whitespace and will never match — which is why the
 * route reads request.text() and parses only after verifying.
 */
export function verifyStripeSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string | undefined;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): VerifyResult {
  if (!args.secret) return { ok: false, reason: "no_secret" };
  if (!args.signatureHeader) return { ok: false, reason: "missing_header" };

  const parsed = parseSignatureHeader(args.signatureHeader);
  if (!parsed) return { ok: false, reason: "malformed_header" };

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  // Rejects both a replayed old request and one with an absurd future
  // timestamp, which would otherwise stay valid forever.
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = computeSignature(args.rawBody, parsed.timestamp, args.secret);
  const matched = parsed.signatures.some((candidate) => safeEquals(candidate, expected));

  return matched ? { ok: true } : { ok: false, reason: "no_matching_signature" };
}

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

export interface StripeChargeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: {
      id: string;
      object: string;
      amount: number;
      amount_refunded?: number;
      currency: string;
      created: number;
      payment_intent?: string | null;
      refunded?: boolean;
      metadata?: Record<string, string>;
    };
  };
}

export type ExtractedCharge =
  | {
      ok: true;
      eventId: string;
      eventType: string;
      chargeId: string;
      paymentIntentId: string | null;
      amountCents: number;
      refundedCents: number;
      currency: string;
      /** Which deal this belongs to, from Stripe metadata. */
      dealId: string | null;
      receivedAt: string;
    }
  | { ok: false; error: string };

/**
 * Pull the fields the ledger needs out of a charge event.
 *
 * The deal is identified by a `deal_id` in the charge's metadata — Stripe has
 * no idea what a deal is, so whatever creates the charge has to put it there.
 * A charge without it is reported rather than guessed at: attaching revenue to
 * the wrong deal pays the wrong person.
 */
export function extractCharge(event: unknown): ExtractedCharge {
  const e = event as StripeChargeEvent;

  if (!e || typeof e !== "object" || !e.data || !e.data.object) {
    return { ok: false, error: "not a Stripe event envelope" };
  }

  const charge = e.data.object;
  if (charge.object !== "charge") {
    return { ok: false, error: `expected a charge, got ${charge.object}` };
  }
  if (!Number.isInteger(charge.amount)) {
    return { ok: false, error: "charge amount is not an integer" };
  }

  const dealId = charge.metadata?.deal_id ?? null;

  return {
    ok: true,
    eventId: e.id,
    eventType: e.type,
    chargeId: charge.id,
    paymentIntentId: charge.payment_intent ?? null,
    // Stripe amounts are already in the currency's smallest unit.
    amountCents: charge.amount,
    refundedCents: charge.amount_refunded ?? 0,
    currency: (charge.currency ?? "usd").toLowerCase(),
    dealId,
    receivedAt: new Date(charge.created * 1000).toISOString(),
  };
}
