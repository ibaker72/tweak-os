import type { SupabaseClient } from "@supabase/supabase-js";
import { accrueDeal, type AccrualResult } from "./accrue";

/**
 * Refund and chargeback handling.
 *
 * Deliberately thin. Clawbacks run through exactly the same planner as
 * accruals (see planDealLedger in calculate.ts), because a separate "money
 * back" code path would eventually disagree with the "money in" path about
 * rounding, and that disagreement surfaces as a cent nobody can account for.
 * A full refund returning the balance to precisely zero is a consequence of
 * both directions sharing one arithmetic, not of a special case.
 *
 * What a clawback never does is edit or delete the original entry. The ledger
 * trigger refuses both; the only correction is a new, negative, reversing row.
 */

export interface RefundInput {
  paymentId: string;
  /** Cumulative refunded total for this payment, in cents — not the increment. */
  refundedAmountCents: number;
  refundedAt?: string;
  /** Who recorded it, for the entry's created_by. */
  createdBy?: string | null;
}

export interface RefundResult extends AccrualResult {
  paymentId: string;
  dealId: string | null;
}

/**
 * Record a refund or chargeback against a payment and write the resulting
 * clawback entries.
 *
 * `refundedAmountCents` is the cumulative refunded total, matching the column
 * it is written to. Passing the same value twice is a no-op: the planner works
 * out how much of the refund has already been clawed back and writes only the
 * remainder.
 */
export async function recordRefund(
  supabase: SupabaseClient,
  input: RefundInput
): Promise<RefundResult> {
  const base: RefundResult = {
    paymentId: input.paymentId,
    dealId: null,
    dealsExamined: 0,
    entriesWritten: 0,
    centsWritten: 0,
    duplicatesIgnored: 0,
    skipped: [],
    errors: [],
  };

  const { data: payment, error: readError } = await supabase
    .from("payments")
    .select("id, deal_id, amount_cents, refunded_amount_cents")
    .eq("id", input.paymentId)
    .maybeSingle();

  if (readError || !payment) {
    base.errors.push({
      deal_id: "*",
      message: readError?.message ?? `payment ${input.paymentId} not found`,
    });
    return base;
  }

  base.dealId = payment.deal_id as string;

  if (input.refundedAmountCents > (payment.amount_cents as number)) {
    base.errors.push({
      deal_id: base.dealId,
      message:
        `refund of ${input.refundedAmountCents} cents exceeds the payment ` +
        `amount of ${payment.amount_cents} cents`,
    });
    return base;
  }

  // The database also enforces refunded_amount_cents <= amount_cents and the
  // date/amount pairing; this update just records the new total.
  const { error: updateError } = await supabase
    .from("payments")
    .update({
      refunded_amount_cents: input.refundedAmountCents,
      refunded_at:
        input.refundedAmountCents > 0
          ? (input.refundedAt ?? new Date().toISOString())
          : null,
    })
    .eq("id", input.paymentId);

  if (updateError) {
    base.errors.push({ deal_id: base.dealId, message: updateError.message });
    return base;
  }

  // Re-plan the deal. The planner sees the larger refund and emits the
  // reversing rows that are still missing.
  const accrual = await accrueDeal(supabase, base.dealId, {
    createdBy: input.createdBy,
  });

  return { ...accrual, paymentId: input.paymentId, dealId: base.dealId };
}

/**
 * A chargeback is a refund the customer initiated. Same ledger consequence —
 * the distinction is recorded in the memo of the payment, not in the maths.
 */
export async function recordChargeback(
  supabase: SupabaseClient,
  input: RefundInput
): Promise<RefundResult> {
  return recordRefund(supabase, input);
}
