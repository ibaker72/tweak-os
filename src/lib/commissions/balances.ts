import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read models over the commission ledger.
 *
 * Every figure here is derived by summing entries. There is no balance column
 * and there must never be one: a stored balance that has been corrected has no
 * history behind it, and that is not an argument you can win with someone
 * whose income it is.
 *
 * These functions read through whatever client they are given, so RLS decides
 * what an agent can see. An agent calling these gets their own numbers because
 * the policies filter the rows, not because these functions check anything.
 */

interface EntryRow {
  amount_cents: number;
  entry_type: "earned" | "clawback" | "adjustment" | "bonus";
  payout_batch_id: string | null;
  payable_at: string;
  deal_id: string;
}

export interface AgentBalance {
  agentId: string;
  /** SUM(amount_cents) WHERE payout_batch_id IS NULL — what is owed now. */
  unpaidCents: number;
  /** Of the unpaid total, the part whose Net 30 has elapsed. */
  payableNowCents: number;
  /** Unpaid but not yet past payable_at. */
  pendingCents: number;
  /** Every positive entry ever written, before clawbacks. */
  lifetimeEarnedCents: number;
  /** Every clawback ever written, as a negative number. */
  lifetimeClawedBackCents: number;
  /** Everything already attached to a payout batch. */
  paidOutCents: number;
  entryCount: number;
}

export interface DealBreakdown {
  dealId: string;
  earnedCents: number;
  clawedBackCents: number;
  netCents: number;
  unpaidCents: number;
  entryCount: number;
}

const LEDGER_COLUMNS = "amount_cents, entry_type, payout_batch_id, payable_at, deal_id";

function sum(rows: EntryRow[], pick: (r: EntryRow) => boolean): number {
  return rows.reduce((total, r) => (pick(r) ? total + r.amount_cents : total), 0);
}

async function loadEntries(
  supabase: SupabaseClient,
  agentId: string
): Promise<EntryRow[]> {
  const { data, error } = await supabase
    .from("commission_entries")
    .select(LEDGER_COLUMNS)
    .eq("agent_id", agentId);

  if (error) throw error;
  return (data ?? []) as unknown as EntryRow[];
}

/**
 * Everything an agent needs to see about their own money.
 *
 * A negative unpaid balance is a real state, not an error: a clawback larger
 * than the current balance carries against future earnings rather than being
 * clamped at zero.
 */
export async function getAgentBalance(
  supabase: SupabaseClient,
  agentId: string,
  now: Date = new Date()
): Promise<AgentBalance> {
  const rows = await loadEntries(supabase, agentId);
  const nowIso = now.toISOString();

  const unpaid = (r: EntryRow) => r.payout_batch_id === null;

  return {
    agentId,
    unpaidCents: sum(rows, unpaid),
    payableNowCents: sum(rows, (r) => unpaid(r) && r.payable_at <= nowIso),
    pendingCents: sum(rows, (r) => unpaid(r) && r.payable_at > nowIso),
    lifetimeEarnedCents: sum(rows, (r) => r.amount_cents > 0),
    lifetimeClawedBackCents: sum(rows, (r) => r.amount_cents < 0),
    paidOutCents: sum(rows, (r) => r.payout_batch_id !== null),
    entryCount: rows.length,
  };
}

/** The same ledger, grouped by deal. */
export async function getDealBreakdown(
  supabase: SupabaseClient,
  agentId: string
): Promise<DealBreakdown[]> {
  const rows = await loadEntries(supabase, agentId);
  const byDeal = new Map<string, EntryRow[]>();

  for (const row of rows) {
    const existing = byDeal.get(row.deal_id);
    if (existing) existing.push(row);
    else byDeal.set(row.deal_id, [row]);
  }

  return [...byDeal.entries()]
    .map(([dealId, dealRows]) => ({
      dealId,
      earnedCents: sum(dealRows, (r) => r.amount_cents > 0),
      clawedBackCents: sum(dealRows, (r) => r.amount_cents < 0),
      netCents: sum(dealRows, () => true),
      unpaidCents: sum(dealRows, (r) => r.payout_batch_id === null),
      entryCount: dealRows.length,
    }))
    .sort((a, b) => b.netCents - a.netCents);
}

/**
 * Unpaid balances for every agent at once, for the admin payout view.
 *
 * Reads the ledger rather than joining per agent so one query answers the
 * whole question; the partial index on (agent_id, payout_batch_id) WHERE
 * payout_batch_id IS NULL serves exactly this.
 */
export async function getUnpaidBalances(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<{ agentId: string; unpaidCents: number; payableNowCents: number }[]> {
  const { data, error } = await supabase
    .from("commission_entries")
    .select("agent_id, amount_cents, payable_at")
    .is("payout_batch_id", null);

  if (error) throw error;
  const nowIso = now.toISOString();

  const totals = new Map<string, { unpaidCents: number; payableNowCents: number }>();
  for (const row of (data ?? []) as unknown as {
    agent_id: string;
    amount_cents: number;
    payable_at: string;
  }[]) {
    const entry = totals.get(row.agent_id) ?? { unpaidCents: 0, payableNowCents: 0 };
    entry.unpaidCents += row.amount_cents;
    if (row.payable_at <= nowIso) entry.payableNowCents += row.amount_cents;
    totals.set(row.agent_id, entry);
  }

  return [...totals.entries()]
    .map(([agentId, v]) => ({ agentId, ...v }))
    .sort((a, b) => b.unpaidCents - a.unpaidCents);
}
