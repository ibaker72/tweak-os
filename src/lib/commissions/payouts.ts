import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Payout batching.
 *
 * A batch is how entries leave an agent's unpaid balance. Because the balance
 * is defined as SUM(amount_cents) WHERE payout_batch_id IS NULL, stamping an
 * entry with a batch id is what marks it paid — and it is the *only* update
 * the ledger trigger permits, one way, once.
 *
 * The stamping is done one entry at a time rather than as a bulk UPDATE so
 * that an entry another run has already claimed is skipped instead of failing
 * the whole batch.
 */

export type PayoutMethod = "stripe" | "paypal";
export type PayoutStatus = "pending" | "processing" | "paid" | "failed";

export interface OpenBatchInput {
  agentId: string;
  periodStart: string;
  periodEnd: string;
  method?: PayoutMethod | null;
  notes?: string | null;
  /** Only entries payable on or before this instant. Defaults to now (Net 30). */
  payableAsOf?: string;
}

export interface BatchResult {
  batchId: string | null;
  agentId: string;
  entriesStamped: number;
  totalCents: number;
  skippedEntries: number;
  errors: string[];
}

interface OpenEntry {
  id: string;
  amount_cents: number;
}

/**
 * Create a batch for one agent and stamp every eligible open entry into it.
 *
 * Eligible means: belongs to this agent, has no batch yet, and its Net 30 has
 * elapsed. Clawbacks are swept in alongside earnings — that is how a negative
 * carries against future work rather than being written off.
 *
 * Returns a batch with zero entries rather than creating an empty one when
 * there is nothing to pay.
 */
export async function openPayoutBatch(
  supabase: SupabaseClient,
  input: OpenBatchInput
): Promise<BatchResult> {
  const result: BatchResult = {
    batchId: null,
    agentId: input.agentId,
    entriesStamped: 0,
    totalCents: 0,
    skippedEntries: 0,
    errors: [],
  };

  const payableAsOf = input.payableAsOf ?? new Date().toISOString();

  const { data: open, error: readError } = await supabase
    .from("commission_entries")
    .select("id, amount_cents")
    .eq("agent_id", input.agentId)
    .is("payout_batch_id", null)
    .lte("payable_at", payableAsOf);

  if (readError) {
    result.errors.push(readError.message);
    return result;
  }

  const entries = (open ?? []) as unknown as OpenEntry[];
  if (entries.length === 0) return result;

  const { data: batch, error: batchError } = await supabase
    .from("payout_batches")
    .insert({
      agent_id: input.agentId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      method: input.method ?? null,
      notes: input.notes ?? null,
      status: "pending",
      total_cents: 0,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    result.errors.push(batchError?.message ?? "could not create payout batch");
    return result;
  }

  result.batchId = batch.id as string;

  // Stamp individually: an entry claimed by a concurrent run is skipped rather
  // than taking the whole batch down with it. The trigger refuses to re-batch
  // an entry that already has a batch, so the loser of a race gets an error
  // here and simply moves on.
  for (const entry of entries) {
    const { data: updated, error } = await supabase
      .from("commission_entries")
      .update({ payout_batch_id: result.batchId })
      .eq("id", entry.id)
      .is("payout_batch_id", null)
      .select("id");

    if (error || !updated || updated.length === 0) {
      result.skippedEntries += 1;
      continue;
    }

    result.entriesStamped += 1;
    result.totalCents += entry.amount_cents;
  }

  // The batch total is the sum of what actually got stamped, not what was
  // originally selected.
  const { error: totalError } = await supabase
    .from("payout_batches")
    .update({ total_cents: result.totalCents })
    .eq("id", result.batchId);

  if (totalError) result.errors.push(totalError.message);

  return result;
}

/** Move a batch through its lifecycle. `paid` stamps paid_at. */
export async function setBatchStatus(
  supabase: SupabaseClient,
  batchId: string,
  status: PayoutStatus,
  options: { externalRef?: string | null; paidAt?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = { status };

  if (status === "paid") {
    patch.paid_at = options.paidAt ?? new Date().toISOString();
  }
  if (options.externalRef !== undefined) {
    patch.external_ref = options.externalRef;
  }

  const { error } = await supabase
    .from("payout_batches")
    .update(patch)
    .eq("id", batchId);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Recompute a batch's total from the entries actually stamped into it.
 *
 * The entries are immutable once batched, so this is only ever a repair for a
 * total written before a stamping loop finished.
 */
export async function reconcileBatchTotal(
  supabase: SupabaseClient,
  batchId: string
): Promise<{ ok: boolean; totalCents: number; error?: string }> {
  const { data, error } = await supabase
    .from("commission_entries")
    .select("amount_cents")
    .eq("payout_batch_id", batchId);

  if (error) return { ok: false, totalCents: 0, error: error.message };

  const totalCents = ((data ?? []) as unknown as { amount_cents: number }[]).reduce(
    (t, e) => t + e.amount_cents,
    0
  );

  const { error: updateError } = await supabase
    .from("payout_batches")
    .update({ total_cents: totalCents })
    .eq("id", batchId);

  return updateError
    ? { ok: false, totalCents, error: updateError.message }
    : { ok: true, totalCents };
}
