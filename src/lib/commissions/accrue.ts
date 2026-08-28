import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertSplitIsExact,
  netClearedCents,
  planDealLedger,
  type DealSnapshot,
  type ExistingEntry,
  type PaymentSnapshot,
  type PlannedEntry,
  type SkippedPayment,
} from "./calculate";

/**
 * The writer.
 *
 * All the arithmetic lives in calculate.ts; this file only loads state, hands
 * it to the planner, checks the result reconciles, and writes what is missing.
 * Keeping the two apart is what lets the money math be tested exhaustively
 * without a database.
 *
 * Idempotence has two independent layers:
 *
 *   The planner compares against entries already in the ledger and plans only
 *   the difference, so re-running is a no-op.
 *
 *   A partial unique index on commission_entries(payment_id) WHERE
 *   entry_type = 'earned' makes a duplicate impossible even if two sweeps
 *   overlap. A conflict there is expected under concurrency, not an error.
 */

const DEAL_COLUMNS =
  "id, commission_model, commission_rate_bps, recurring_cap_months, closed_by_agent_id";
const PAYMENT_COLUMNS =
  "id, deal_id, milestone_id, amount_cents, refunded_amount_cents, received_at, cleared_at, period_start, period_end";

export interface AccrualResult {
  dealsExamined: number;
  entriesWritten: number;
  centsWritten: number;
  duplicatesIgnored: number;
  skipped: SkippedPayment[];
  errors: { deal_id: string; message: string }[];
}

function emptyResult(): AccrualResult {
  return {
    dealsExamined: 0,
    entriesWritten: 0,
    centsWritten: 0,
    duplicatesIgnored: 0,
    skipped: [],
    errors: [],
  };
}

/**
 * Bring one deal's ledger up to date with its cleared payments.
 *
 * Safe to call repeatedly. Returns what it did, including the payments it
 * deliberately did not accrue and why — rule 5's "write nothing and log why"
 * applies to every skip reason, not just the cap.
 */
export async function accrueDeal(
  supabase: SupabaseClient,
  dealId: string,
  options: { createdBy?: string | null } = {}
): Promise<AccrualResult> {
  const result = emptyResult();

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select(DEAL_COLUMNS)
    .eq("id", dealId)
    .maybeSingle();

  if (dealError) {
    result.errors.push({ deal_id: dealId, message: dealError.message });
    return result;
  }
  if (!deal) {
    result.errors.push({ deal_id: dealId, message: "deal not found" });
    return result;
  }

  result.dealsExamined = 1;

  const [{ data: payments, error: paymentsError }, { data: entries, error: entriesError }] =
    await Promise.all([
      supabase.from("payments").select(PAYMENT_COLUMNS).eq("deal_id", dealId),
      supabase
        .from("commission_entries")
        .select("id, payment_id, entry_type, amount_cents")
        .eq("deal_id", dealId),
    ]);

  if (paymentsError || entriesError) {
    result.errors.push({
      deal_id: dealId,
      message: (paymentsError ?? entriesError)!.message,
    });
    return result;
  }

  const plan = planDealLedger({
    deal: deal as unknown as DealSnapshot,
    payments: (payments ?? []) as unknown as PaymentSnapshot[],
    existingEntries: (entries ?? []) as unknown as ExistingEntry[],
  });

  result.skipped = plan.skipped;
  if (plan.entries.length === 0) return result;

  // Rule 7: prove the split reconciles before persisting any of it. A one-cent
  // drift is a bug, and it is far cheaper to refuse here than to discover it
  // in a payout run.
  try {
    verifyReconciliation({
      deal: deal as unknown as DealSnapshot,
      payments: (payments ?? []) as unknown as PaymentSnapshot[],
      existingEntries: (entries ?? []) as unknown as ExistingEntry[],
      planned: plan.entries,
    });
  } catch (err) {
    result.errors.push({
      deal_id: dealId,
      message: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  const written = await insertEntries(supabase, plan.entries, options.createdBy ?? null);
  result.entriesWritten = written.inserted.length;
  result.centsWritten = written.inserted.reduce((t, e) => t + e.amount_cents, 0);
  result.duplicatesIgnored = written.duplicates;
  result.errors.push(
    ...written.errors.map((message) => ({ deal_id: dealId, message }))
  );

  if (written.inserted.length > 0) {
    await refreshRecurringCounter(supabase, deal as unknown as DealSnapshot);
  }

  return result;
}

/**
 * Sweep every deal with a cleared payment that the ledger has not caught up
 * with. This is what the nightly cron runs.
 *
 * `since` narrows the sweep to payments that cleared recently; omit it for a
 * full rebuild, which is safe precisely because the engine is idempotent.
 */
export async function sweepClearedPayments(
  supabase: SupabaseClient,
  options: { since?: string | null; createdBy?: string | null; limit?: number } = {}
): Promise<AccrualResult> {
  const totals = emptyResult();

  let query = supabase
    .from("payments")
    .select("deal_id, cleared_at")
    .not("cleared_at", "is", null)
    .order("cleared_at", { ascending: true });

  if (options.since) query = query.gte("cleared_at", options.since);
  if (options.limit) query = query.limit(options.limit);

  const { data: rows, error } = await query;
  if (error) {
    totals.errors.push({ deal_id: "*", message: error.message });
    return totals;
  }

  const dealIds = [...new Set((rows ?? []).map((r) => r.deal_id as string))];

  for (const dealId of dealIds) {
    const one = await accrueDeal(supabase, dealId, { createdBy: options.createdBy });
    totals.dealsExamined += one.dealsExamined;
    totals.entriesWritten += one.entriesWritten;
    totals.centsWritten += one.centsWritten;
    totals.duplicatesIgnored += one.duplicatesIgnored;
    totals.skipped.push(...one.skipped);
    totals.errors.push(...one.errors);
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * For a one-time deal the whole ledger must equal the rate on the net cleared
 * basis. Recurring deals have no single total to converge on — the cap means
 * later months deliberately accrue nothing — so the per-entry arithmetic in
 * the planner is the guarantee there.
 */
function verifyReconciliation(args: {
  deal: DealSnapshot;
  payments: PaymentSnapshot[];
  existingEntries: ExistingEntry[];
  planned: PlannedEntry[];
}): void {
  if (args.deal.commission_model !== "one_time") return;
  if (args.deal.commission_rate_bps === null) return;

  const netBasis = args.payments
    .filter((p) => p.deal_id === args.deal.id && p.cleared_at !== null)
    .reduce((total, p) => total + netClearedCents(p), 0);

  const existingLedgerCents = args.existingEntries
    .filter((e) => e.entry_type === "earned" || e.entry_type === "clawback")
    .reduce((total, e) => total + e.amount_cents, 0);

  assertSplitIsExact({
    sourceBasisCents: netBasis,
    rateBps: args.deal.commission_rate_bps,
    entries: args.planned,
    existingLedgerCents,
  });
}

/**
 * Insert planned entries one at a time so a unique-index conflict on one
 * payment does not discard the rest of the batch. 23505 here means another
 * sweep got there first, which is the index doing its job.
 */
async function insertEntries(
  supabase: SupabaseClient,
  planned: PlannedEntry[],
  createdBy: string | null
): Promise<{ inserted: PlannedEntry[]; duplicates: number; errors: string[] }> {
  const inserted: PlannedEntry[] = [];
  const errors: string[] = [];
  let duplicates = 0;

  for (const entry of planned) {
    const { error } = await supabase.from("commission_entries").insert({
      agent_id: entry.agent_id,
      deal_id: entry.deal_id,
      payment_id: entry.payment_id,
      entry_type: entry.entry_type,
      amount_cents: entry.amount_cents,
      rate_bps_applied: entry.rate_bps_applied,
      basis_cents: entry.basis_cents,
      memo: entry.memo,
      payable_at: entry.payable_at,
      created_by: createdBy,
    });

    if (!error) {
      inserted.push(entry);
      continue;
    }
    if (error.code === "23505") {
      duplicates += 1;
      continue;
    }
    errors.push(`${entry.payment_id}: ${error.message}`);
  }

  return { inserted, duplicates, errors };
}

/**
 * Keep deals.recurring_months_accrued in step with the ledger.
 *
 * Derived from a count rather than incremented, so a retry cannot advance it
 * twice and a manual correction cannot leave it wrong. The planner reads the
 * ledger for the cap check regardless — this column exists for display and for
 * anyone querying the table directly.
 */
async function refreshRecurringCounter(
  supabase: SupabaseClient,
  deal: DealSnapshot
): Promise<void> {
  if (deal.commission_model !== "recurring") return;

  const { count, error } = await supabase
    .from("commission_entries")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", deal.id)
    .eq("entry_type", "earned");

  if (error || count === null) return;

  await supabase
    .from("deals")
    .update({ recurring_months_accrued: count })
    .eq("id", deal.id);
}
