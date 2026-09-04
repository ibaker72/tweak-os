/**
 * Commission calculation — pure.
 *
 * Nothing in this file touches the database, the clock, or the network. Every
 * function is a deterministic transform of its inputs, which is what makes the
 * money math exhaustively testable.
 *
 * Two rules drive the shape of everything here:
 *
 *   Cents-only integer arithmetic. No floats ever hold money. A rate is
 *   integer basis points (3000 = 30%).
 *
 *   Round half-up, once, at the final step. Never round an intermediate and
 *   then round again — that is how a ledger drifts a cent at a time.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type CommissionModel = "one_time" | "recurring";
export type EntryType = "earned" | "clawback" | "adjustment" | "bonus";

/** The fields of a deal the engine reads. Mirrors public.deals. */
export interface DealSnapshot {
  id: string;
  commission_model: CommissionModel;
  /**
   * Snapshotted at signing. The engine uses this and never the agent's
   * current default — a rate change must not reprice history.
   */
  commission_rate_bps: number | null;
  recurring_cap_months: number | null;
  closed_by_agent_id: string | null;
}

/** The fields of a payment the engine reads. Mirrors public.payments. */
export interface PaymentSnapshot {
  id: string;
  deal_id: string;
  milestone_id: string | null;
  amount_cents: number;
  refunded_amount_cents: number;
  received_at: string;
  /** NULL until the money settles. Commission accrues off this, never received_at. */
  cleared_at: string | null;
  period_start?: string | null;
  period_end?: string | null;
}

/** An entry already in the ledger. Only the fields the planner needs. */
export interface ExistingEntry {
  id: string;
  payment_id: string | null;
  entry_type: EntryType;
  amount_cents: number;
}

/** An entry the planner says should be written. */
export interface PlannedEntry {
  agent_id: string;
  deal_id: string;
  payment_id: string;
  entry_type: Extract<EntryType, "earned" | "clawback">;
  /** Signed. Clawbacks are negative. */
  amount_cents: number;
  rate_bps_applied: number;
  /** What the rate was applied to, so any row can be re-derived by hand. */
  basis_cents: number;
  memo: string;
  /** cleared_at + 30 days (Net 30). ISO 8601. */
  payable_at: string;
}

export type SkipReason =
  | "not_cleared"
  | "no_rate_snapshot"
  | "no_agent"
  | "recurring_cap_reached"
  | "zero_basis"
  | "already_accrued";

export interface SkippedPayment {
  payment_id: string;
  reason: SkipReason;
  detail: string;
}

export interface LedgerPlan {
  entries: PlannedEntry[];
  skipped: SkippedPayment[];
}

// ---------------------------------------------------------------------------
// Core arithmetic
// ---------------------------------------------------------------------------

export const NET_TERMS_DAYS = 30;
const BPS_DENOMINATOR = 10_000;

export class CommissionMathError extends Error {}

/**
 * Apply a basis-point rate to a cent amount, returning whole cents.
 *
 * Rounds half-up. Callers must pass a non-negative basis: every basis in this
 * engine is a payment or refund magnitude, both of which the database
 * constrains to be >= 0. Half-up on a negative would round toward zero and
 * make a clawback fail to mirror the entry it reverses, so passing one is
 * treated as a programming error rather than silently tolerated.
 */
export function applyRateBps(basisCents: number, rateBps: number): number {
  if (!Number.isInteger(basisCents)) {
    throw new CommissionMathError(
      `basis must be integer cents, got ${basisCents}`
    );
  }
  if (!Number.isInteger(rateBps)) {
    throw new CommissionMathError(`rate must be integer bps, got ${rateBps}`);
  }
  if (basisCents < 0) {
    throw new CommissionMathError(
      `basis must be non-negative; negate the result instead of the basis (got ${basisCents})`
    );
  }
  if (rateBps < 0 || rateBps > BPS_DENOMINATOR) {
    throw new CommissionMathError(`rate out of range: ${rateBps} bps`);
  }

  const product = basisCents * rateBps;
  if (!Number.isSafeInteger(product)) {
    throw new CommissionMathError(
      `commission basis overflows exact integer arithmetic: ${basisCents} x ${rateBps}`
    );
  }

  // Single rounding step, half-up. `product` is non-negative here, so integer
  // division plus a remainder test is exact.
  const whole = Math.floor(product / BPS_DENOMINATOR);
  const remainder = product % BPS_DENOMINATOR;
  return remainder * 2 >= BPS_DENOMINATOR ? whole + 1 : whole;
}

/** Net cents a payment actually contributes: received less anything refunded. */
export function netClearedCents(payment: PaymentSnapshot): number {
  return payment.amount_cents - payment.refunded_amount_cents;
}

/** cleared_at + 30 days, as an ISO string. */
export function payableAt(clearedAt: string): string {
  const d = new Date(clearedAt);
  if (Number.isNaN(d.getTime())) {
    throw new CommissionMathError(`invalid cleared_at: ${clearedAt}`);
  }
  d.setUTCDate(d.getUTCDate() + NET_TERMS_DAYS);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function sumAmounts(entries: ExistingEntry[]): number {
  return entries.reduce((total, e) => total + e.amount_cents, 0);
}

/** Entries that move an agent's balance: earned and clawback. */
function ledgerEntries(entries: ExistingEntry[]): ExistingEntry[] {
  return entries.filter(
    (e) => e.entry_type === "earned" || e.entry_type === "clawback"
  );
}

function isCleared(p: PaymentSnapshot): boolean {
  return p.cleared_at !== null && p.cleared_at !== undefined;
}

/**
 * Work out every entry still missing from a deal's ledger.
 *
 * This is the whole engine. Accrual and clawback share it deliberately: two
 * separate code paths for "money in" and "money back" would eventually
 * disagree about rounding, and the disagreement would surface as a cent that
 * nobody can account for.
 *
 * Idempotent by construction — feed it the state it just produced and it plans
 * nothing further.
 *
 * One-time deals use a target-and-delta model. The deal's total commission is
 * always `applyRateBps(net cleared basis, rate)` and each entry is the step
 * needed to reach it. That is what makes three uneven milestones sum to
 * exactly the same total as one payment for the full amount, and what makes a
 * full refund return the balance to precisely zero — both fall out of the same
 * arithmetic instead of being special cases.
 *
 * Recurring deals accrue per cleared month, because there is no fixed total to
 * converge on and the month cap counts entries.
 */
export function planDealLedger(input: {
  deal: DealSnapshot;
  payments: PaymentSnapshot[];
  existingEntries: ExistingEntry[];
}): LedgerPlan {
  const { deal, payments, existingEntries } = input;
  const skipped: SkippedPayment[] = [];

  const cleared = payments
    .filter((p) => p.deal_id === deal.id)
    .filter((p) => {
      if (isCleared(p)) return true;
      // Rule 1: signing earns nothing, and neither does money that has arrived
      // but not settled. received_at without cleared_at is the refund window.
      skipped.push({
        payment_id: p.id,
        reason: "not_cleared",
        detail: `payment ${p.id} was received but has not cleared`,
      });
      return false;
    })
    .sort((a, b) => String(a.cleared_at).localeCompare(String(b.cleared_at)));

  if (cleared.length === 0) return { entries: [], skipped };

  if (deal.closed_by_agent_id === null) {
    return {
      entries: [],
      skipped: [
        ...skipped,
        ...cleared.map((p) => ({
          payment_id: p.id,
          reason: "no_agent" as const,
          detail: `deal ${deal.id} has no closed_by_agent_id; nobody to credit`,
        })),
      ],
    };
  }

  if (deal.commission_rate_bps === null) {
    return {
      entries: [],
      skipped: [
        ...skipped,
        ...cleared.map((p) => ({
          payment_id: p.id,
          reason: "no_rate_snapshot" as const,
          detail: `deal ${deal.id} has no commission_rate_bps snapshot`,
        })),
      ],
    };
  }

  const agentId = deal.closed_by_agent_id;
  const rate = deal.commission_rate_bps;

  return deal.commission_model === "recurring"
    ? planRecurring({ deal, agentId, rate, cleared, existingEntries, skipped })
    : planOneTime({ deal, agentId, rate, cleared, existingEntries, skipped });
}

function planOneTime(args: {
  deal: DealSnapshot;
  agentId: string;
  rate: number;
  cleared: PaymentSnapshot[];
  existingEntries: ExistingEntry[];
  skipped: SkippedPayment[];
}): LedgerPlan {
  const { deal, agentId, rate, cleared, existingEntries, skipped } = args;
  const entries: PlannedEntry[] = [];

  // Running totals, both scoped to the payments walked so far.
  //
  // `accrued` must track the ledger for that same prefix — not the whole
  // ledger. Seeding it with the full total only happens to work while entries
  // are appended in cleared_at order: the first iteration would then compare
  // the commission on payment 1 against the commission on *every* payment.
  // Once an earlier payment is refunded that comparison is wildly negative,
  // which produced an oversized clawback on the first payment and a
  // compensating `earned` row for a payment that already had one — and that
  // second row is refused by uq_commission_entries_earned_per_payment_agent
  // and silently dropped, leaving the agent underpaid. So each payment's
  // existing entries are folded in as it is reached.
  let basisSoFar = 0;
  let accrued = 0;

  for (const payment of cleared) {
    const net = netClearedCents(payment);
    basisSoFar += net;
    accrued += sumAmounts(
      ledgerEntries(existingEntries.filter((e) => e.payment_id === payment.id))
    );

    // Round once, on the cumulative basis. The entry is the difference between
    // where the ledger should be and where it is.
    const target = applyRateBps(Math.max(basisSoFar, 0), rate);
    const delta = target - accrued;

    if (delta === 0) {
      skipped.push({
        payment_id: payment.id,
        reason: existingEntries.some((e) => e.payment_id === payment.id)
          ? "already_accrued"
          : "zero_basis",
        detail:
          `deal ${deal.id} is already accrued to ${target} cents; ` +
          `payment ${payment.id} moves it by 0`,
      });
      continue;
    }

    const isClawback = delta < 0;
    entries.push({
      agent_id: agentId,
      deal_id: deal.id,
      payment_id: payment.id,
      entry_type: isClawback ? "clawback" : "earned",
      amount_cents: delta,
      rate_bps_applied: rate,
      // The basis is the cumulative net figure the target was computed from,
      // so the row can be re-derived by hand from the ledger alone.
      basis_cents: Math.max(basisSoFar, 0),
      memo: isClawback
        ? `Clawback on refund of payment ${payment.id}`
        : payment.milestone_id
          ? `Milestone commission on payment ${payment.id}`
          : `Commission on payment ${payment.id}`,
      payable_at: payableAt(payment.cleared_at as string),
    });

    accrued = target;
  }

  return { entries, skipped };
}

function planRecurring(args: {
  deal: DealSnapshot;
  agentId: string;
  rate: number;
  cleared: PaymentSnapshot[];
  existingEntries: ExistingEntry[];
  skipped: SkippedPayment[];
}): LedgerPlan {
  const { deal, agentId, rate, cleared, existingEntries, skipped } = args;
  const entries: PlannedEntry[] = [];

  // The cap counts earned months, taken from the ledger rather than from
  // deals.recurring_months_accrued so that a stale counter can never authorise
  // a month past the cap. The writer refreshes that column from this same
  // source of truth.
  let monthsAccrued = existingEntries.filter(
    (e) => e.entry_type === "earned"
  ).length;

  for (const payment of cleared) {
    const earnedForPayment = existingEntries.find(
      (e) => e.payment_id === payment.id && e.entry_type === "earned"
    );

    if (!earnedForPayment) {
      // Rule 5: check the cap before writing. A null cap accrues indefinitely.
      if (
        deal.recurring_cap_months !== null &&
        monthsAccrued >= deal.recurring_cap_months
      ) {
        skipped.push({
          payment_id: payment.id,
          reason: "recurring_cap_reached",
          detail:
            `deal ${deal.id} has accrued ${monthsAccrued} of ` +
            `${deal.recurring_cap_months} capped months; payment ${payment.id} accrues nothing`,
        });
        continue;
      }

      const net = netClearedCents(payment);
      if (net <= 0) {
        skipped.push({
          payment_id: payment.id,
          reason: "zero_basis",
          detail: `payment ${payment.id} nets ${net} cents after refunds`,
        });
        continue;
      }

      entries.push({
        agent_id: agentId,
        deal_id: deal.id,
        payment_id: payment.id,
        entry_type: "earned",
        amount_cents: applyRateBps(net, rate),
        rate_bps_applied: rate,
        basis_cents: net,
        memo: `Retainer month ${monthsAccrued + 1} on payment ${payment.id}`,
        payable_at: payableAt(payment.cleared_at as string),
      });
      monthsAccrued += 1;
      continue;
    }

    // Already earned. The only thing left to do is mirror any refund.
    if (payment.refunded_amount_cents > 0) {
      const targetClawback = applyRateBps(payment.refunded_amount_cents, rate);
      const alreadyClawedBack = -sumAmounts(
        existingEntries.filter(
          (e) => e.payment_id === payment.id && e.entry_type === "clawback"
        )
      );
      const delta = targetClawback - alreadyClawedBack;

      if (delta > 0) {
        entries.push({
          agent_id: agentId,
          deal_id: deal.id,
          payment_id: payment.id,
          entry_type: "clawback",
          amount_cents: -delta,
          rate_bps_applied: rate,
          basis_cents: payment.refunded_amount_cents,
          memo: `Clawback on refund of payment ${payment.id}`,
          payable_at: payableAt(payment.cleared_at as string),
        });
        continue;
      }
    }

    skipped.push({
      payment_id: payment.id,
      reason: "already_accrued",
      detail: `payment ${payment.id} already has an earned entry`,
    });
  }

  return { entries, skipped };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Assert that a set of entries splitting one source amount adds up to exactly
 * the commission on that amount.
 *
 * Rule 7's "assert the sum of split entries equals the source amount exactly".
 * Called by the writer before anything is persisted: a drift of one cent is a
 * bug, and it is far cheaper to fail here than to find it in a payout.
 */
export function assertSplitIsExact(args: {
  sourceBasisCents: number;
  rateBps: number;
  entries: Pick<PlannedEntry, "amount_cents">[];
  existingLedgerCents?: number;
}): void {
  const expected = applyRateBps(Math.max(args.sourceBasisCents, 0), args.rateBps);
  const actual =
    (args.existingLedgerCents ?? 0) +
    args.entries.reduce((total, e) => total + e.amount_cents, 0);

  if (actual !== expected) {
    throw new CommissionMathError(
      `commission split does not reconcile: entries total ${actual} cents but ` +
        `${args.rateBps} bps of ${args.sourceBasisCents} cents is ${expected} cents ` +
        `(drift ${actual - expected})`
    );
  }
}
