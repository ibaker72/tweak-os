import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { extractCharge, verifyStripeSignature } from "@/lib/stripe/signature";
import { recordRefund } from "@/lib/commissions/clawback";

/**
 * POST /api/webhooks/stripe — payments arrive here.
 *
 * The decision this implements: Stripe is the source of truth for payments,
 * but charge.succeeded means the money *arrived*, not that it is safe. So this
 * writes received_at and leaves cleared_at null. Clearing happens later, once
 * the settlement window has passed, via the nightly cron.
 *
 * That gap is the chargeback buffer, and it is the whole reason Phase 2 kept
 * received_at and cleared_at as separate columns. Setting cleared_at here
 * would accrue commission on money that can still reverse.
 *
 * Authenticated by Stripe's HMAC signature, not a session — same category as
 * the Twilio webhook, and the second of the two places the service-role client
 * is allowed.
 */

export const runtime = "nodejs";

/** Stripe retries on non-2xx, so a permanent failure returns 200 with a note. */
function accepted(detail: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, detail, ...extra });
}

export async function POST(request: NextRequest) {
  // The raw body, byte for byte. Parsing first and re-serialising would change
  // key order and whitespace, and the signature would never match.
  const rawBody = await request.text();

  const verification = verifyStripeSignature({
    rawBody,
    signatureHeader: request.headers.get("stripe-signature"),
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  if (!verification.ok) {
    console.warn("Stripe webhook rejected:", verification.reason);
    // 400 so Stripe surfaces it in the dashboard, but with nothing that
    // confirms whether the secret is configured.
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = (event as { type?: string }).type ?? "";

  // Only charge events move money in this system.
  if (!eventType.startsWith("charge.")) {
    return accepted(`ignored event type ${eventType}`);
  }

  const charge = extractCharge(event);
  if (!charge.ok) {
    console.warn("Stripe webhook: unusable charge payload:", charge.error);
    return accepted(`unusable payload: ${charge.error}`);
  }

  // Typed as the generic client: service.ts returns a narrowly-inferred
  // shape because no generated Database type is wired up yet.
  const supabase = createServiceClient() as unknown as SupabaseClient;

  try {
    switch (eventType) {
      case "charge.succeeded":
        return await handleSucceeded(supabase, charge);

      case "charge.refunded":
      case "charge.dispute.created":
      case "charge.dispute.funds_withdrawn":
        return await handleRefund(supabase, charge);

      default:
        return accepted(`ignored charge event ${eventType}`);
    }
  } catch (err) {
    console.error("Stripe webhook error:", err);
    // 500 so Stripe retries — a transient database failure should not lose a
    // payment.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

type Charge = Extract<ReturnType<typeof extractCharge>, { ok: true }>;
type ServiceClient = SupabaseClient;

async function handleSucceeded(supabase: ServiceClient, charge: Charge) {
  if (!charge.dealId) {
    // Attaching revenue to a guessed deal pays the wrong person. Better to
    // record nothing and have someone notice than to be quietly wrong.
    console.warn(`Stripe charge ${charge.chargeId} has no deal_id in metadata`);
    return accepted("charge has no deal_id metadata; nothing recorded", {
      charge_id: charge.chargeId,
    });
  }

  const { data: deal } = await supabase
    .from("deals")
    .select("id")
    .eq("id", charge.dealId)
    .maybeSingle();

  if (!deal) {
    console.warn(`Stripe charge ${charge.chargeId} names unknown deal ${charge.dealId}`);
    return accepted("deal_id does not match a known deal", {
      charge_id: charge.chargeId,
      deal_id: charge.dealId,
    });
  }

  const { error } = await supabase.from("payments").insert({
    deal_id: charge.dealId,
    amount_cents: charge.amountCents,
    currency: charge.currency,
    received_at: charge.receivedAt,
    // Deliberately null. The settlement sweep clears it once the chargeback
    // window has passed.
    cleared_at: null,
    method: "stripe",
    source: "stripe",
    external_ref: charge.chargeId,
    stripe_charge_id: charge.chargeId,
    stripe_payment_intent_id: charge.paymentIntentId,
  });

  if (error) {
    // The unique index on stripe_charge_id makes a replayed webhook a no-op
    // rather than a duplicate payment.
    if (error.code === "23505") {
      return accepted("charge already recorded", { charge_id: charge.chargeId });
    }
    throw error;
  }

  return accepted("payment recorded as received, pending settlement", {
    charge_id: charge.chargeId,
    deal_id: charge.dealId,
    amount_cents: charge.amountCents,
  });
}

async function handleRefund(supabase: ServiceClient, charge: Charge) {
  const { data: payment } = await supabase
    .from("payments")
    .select("id")
    .eq("stripe_charge_id", charge.chargeId)
    .maybeSingle<{ id: string }>();

  if (!payment) {
    console.warn(`Refund for unknown charge ${charge.chargeId}`);
    return accepted("refund for a charge we never recorded", {
      charge_id: charge.chargeId,
    });
  }

  // recordRefund re-plans the whole deal, so it writes the clawback entries
  // that are still missing and is a no-op if the refund was already applied.
  const result = await recordRefund(supabase, {
    paymentId: payment.id,
    refundedAmountCents: charge.refundedCents,
    createdBy: null,
  });

  if (result.errors.length > 0) {
    console.error("Refund handling errors:", result.errors);
  }

  return accepted("refund recorded", {
    charge_id: charge.chargeId,
    refunded_cents: charge.refundedCents,
    clawback_entries: result.entriesWritten,
  });
}
