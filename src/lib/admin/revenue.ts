/**
 * Revenue and commission-load metrics — pure.
 *
 * The number this module exists for is `commissionRateOfCollected`: total
 * commission written against total revenue actually collected. That single
 * figure is what tells you whether the commission structure is working, and
 * it is the one a per-deal view will never show you, because the damage from
 * an uncapped recurring rate accumulates across the book rather than showing
 * up on any individual deal.
 *
 * Everything is integer cents. Ratios are returned in basis points so they
 * stay integers too, and are only turned into a percentage at the render edge.
 */

export interface PaymentRow {
  deal_id: string;
  amount_cents: number;
  refunded_amount_cents: number;
  cleared_at: string | null;
  received_at: string;
}

export interface DealRow {
  id: string;
  account_id: string;
  commission_model: "one_time" | "recurring";
  mrr_cents: number;
  contract_value_cents: number;
  status: string;
  closed_by_agent_id: string | null;
  signed_at: string | null;
  created_at?: string;
}

export interface EntryRow {
  agent_id: string;
  deal_id: string;
  amount_cents: number;
  created_at: string;
}

export interface MonthBucket {
  /** YYYY-MM */
  month: string;
  newDeals: number;
  newBusinessCents: number;
  collectedCents: number;
  commissionCents: number;
  /** Commission as a share of collected, in basis points. */
  commissionRateBps: number | null;
}

/** Statuses that count as live recurring revenue. */
const LIVE_STATUSES = new Set(["signed", "delivering", "complete"]);

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Net of refunds. A payment refunded in full contributes nothing. */
export function netCents(p: PaymentRow): number {
  return p.amount_cents - p.refunded_amount_cents;
}

/**
 * Monthly recurring revenue: the sum of mrr_cents across live recurring deals.
 *
 * Deliberately counts contracted MRR rather than what was collected last
 * month, so a late payment does not read as churn.
 */
export function currentMrrCents(deals: DealRow[]): number {
  return deals
    .filter((d) => d.commission_model === "recurring" && LIVE_STATUSES.has(d.status))
    .reduce((total, d) => total + d.mrr_cents, 0);
}

/**
 * Total collected: cleared payments only, net of refunds.
 *
 * Uncleared money is not collected — that is the same distinction the accrual
 * engine makes, and using a different one here would make the two disagree.
 */
export function collectedCents(payments: PaymentRow[]): number {
  return payments
    .filter((p) => p.cleared_at !== null)
    .reduce((total, p) => total + netCents(p), 0);
}

/**
 * Commission written as a share of revenue collected, in basis points.
 *
 * Null when nothing has been collected — a ratio against zero is not "0%",
 * it is undefined, and showing 0% would read as "commission is free".
 */
export function commissionRateOfCollectedBps(
  commissionCents: number,
  collected: number
): number | null {
  if (collected <= 0) return null;
  return Math.round((commissionCents / collected) * 10_000);
}

/**
 * New business and collections bucketed by month.
 *
 * New business is bucketed by signing date; collections and commission by the
 * date the money cleared and the entry was written. They deliberately do not
 * line up — a deal signed in March collecting in May is exactly the lag an
 * agency needs to see.
 */
export function monthlyBuckets(input: {
  deals: DealRow[];
  payments: PaymentRow[];
  entries: EntryRow[];
  months?: number;
}): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();

  const ensure = (month: string): MonthBucket => {
    const existing = buckets.get(month);
    if (existing) return existing;
    const fresh: MonthBucket = {
      month,
      newDeals: 0,
      newBusinessCents: 0,
      collectedCents: 0,
      commissionCents: 0,
      commissionRateBps: null,
    };
    buckets.set(month, fresh);
    return fresh;
  };

  for (const deal of input.deals) {
    if (!deal.signed_at) continue;
    if (deal.status === "lost") continue;
    const bucket = ensure(monthOf(deal.signed_at));
    bucket.newDeals += 1;
    bucket.newBusinessCents +=
      deal.commission_model === "recurring" ? deal.mrr_cents : deal.contract_value_cents;
  }

  for (const payment of input.payments) {
    if (!payment.cleared_at) continue;
    ensure(monthOf(payment.cleared_at)).collectedCents += netCents(payment);
  }

  for (const entry of input.entries) {
    ensure(monthOf(entry.created_at)).commissionCents += entry.amount_cents;
  }

  for (const bucket of buckets.values()) {
    bucket.commissionRateBps = commissionRateOfCollectedBps(
      bucket.commissionCents,
      bucket.collectedCents
    );
  }

  const sorted = [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
  return input.months ? sorted.slice(-input.months) : sorted;
}

export interface AgentPerformance {
  agentId: string;
  dealsWon: number;
  dealsLost: number;
  /** Won / (won + lost), in basis points. Null when nothing has closed either way. */
  closeRateBps: number | null;
  newBusinessCents: number;
  commissionCents: number;
  /** This agent's commission over revenue collected on their own deals. */
  commissionRateOfCollectedBps: number | null;
  collectedCents: number;
}

/**
 * Per-agent close rate and commission load.
 *
 * Close rate counts only deals that actually resolved. Deals still in flight
 * are excluded from both sides rather than counted as losses, so an agent with
 * a full pipeline is not punished for not having closed it yet.
 */
export function agentPerformance(input: {
  deals: DealRow[];
  payments: PaymentRow[];
  entries: EntryRow[];
}): AgentPerformance[] {
  const paymentsByDeal = new Map<string, PaymentRow[]>();
  for (const p of input.payments) {
    const list = paymentsByDeal.get(p.deal_id);
    if (list) list.push(p);
    else paymentsByDeal.set(p.deal_id, [p]);
  }

  const byAgent = new Map<string, AgentPerformance>();
  const ensure = (agentId: string): AgentPerformance => {
    const existing = byAgent.get(agentId);
    if (existing) return existing;
    const fresh: AgentPerformance = {
      agentId,
      dealsWon: 0,
      dealsLost: 0,
      closeRateBps: null,
      newBusinessCents: 0,
      commissionCents: 0,
      commissionRateOfCollectedBps: null,
      collectedCents: 0,
    };
    byAgent.set(agentId, fresh);
    return fresh;
  };

  for (const deal of input.deals) {
    if (!deal.closed_by_agent_id) continue;
    const perf = ensure(deal.closed_by_agent_id);

    if (LIVE_STATUSES.has(deal.status)) {
      perf.dealsWon += 1;
      perf.newBusinessCents +=
        deal.commission_model === "recurring" ? deal.mrr_cents : deal.contract_value_cents;
    } else if (deal.status === "lost") {
      perf.dealsLost += 1;
    }
    // draft, sent and refunded count toward neither.

    perf.collectedCents += collectedCents(paymentsByDeal.get(deal.id) ?? []);
  }

  for (const entry of input.entries) {
    ensure(entry.agent_id).commissionCents += entry.amount_cents;
  }

  for (const perf of byAgent.values()) {
    const resolved = perf.dealsWon + perf.dealsLost;
    perf.closeRateBps = resolved === 0 ? null : Math.round((perf.dealsWon / resolved) * 10_000);
    perf.commissionRateOfCollectedBps = commissionRateOfCollectedBps(
      perf.commissionCents,
      perf.collectedCents
    );
  }

  return [...byAgent.values()].sort((a, b) => b.newBusinessCents - a.newBusinessCents);
}

export interface RevenueSummary {
  mrrCents: number;
  collectedCents: number;
  commissionCents: number;
  commissionRateBps: number | null;
  /** Contracted commission still to be paid on capped retainers, if all run to cap. */
  recurringCommitmentCents: number;
}

/**
 * Headline numbers.
 *
 * recurringCommitmentCents is the forward liability on retainers: what is
 * still owed if every live capped retainer runs to its cap. An uncapped
 * retainer contributes nothing to it, because that liability has no end and
 * cannot honestly be summed into a single figure — the UI flags those
 * separately rather than pretending the total is complete.
 */
export function revenueSummary(input: {
  deals: DealRow[];
  payments: PaymentRow[];
  entries: EntryRow[];
  ratesByDeal: Record<string, { rateBps: number | null; capMonths: number | null; accrued: number }>;
}): RevenueSummary & { uncappedRecurringDeals: number } {
  const collected = collectedCents(input.payments);
  const commission = input.entries.reduce((t, e) => t + e.amount_cents, 0);

  let commitment = 0;
  let uncapped = 0;

  for (const deal of input.deals) {
    if (deal.commission_model !== "recurring") continue;
    if (!LIVE_STATUSES.has(deal.status)) continue;

    const meta = input.ratesByDeal[deal.id];
    if (!meta || meta.rateBps === null) continue;

    if (meta.capMonths === null) {
      uncapped += 1;
      continue;
    }

    const remainingMonths = Math.max(meta.capMonths - meta.accrued, 0);
    const perMonth = Math.round((deal.mrr_cents * meta.rateBps) / 10_000);
    commitment += perMonth * remainingMonths;
  }

  return {
    mrrCents: currentMrrCents(input.deals),
    collectedCents: collected,
    commissionCents: commission,
    commissionRateBps: commissionRateOfCollectedBps(commission, collected),
    recurringCommitmentCents: commitment,
    uncappedRecurringDeals: uncapped,
  };
}
