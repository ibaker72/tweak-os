import { applyRateBps } from "@/lib/commissions/calculate";

/**
 * Pipeline maths for /my/pipeline — pure.
 *
 * An agent who cannot see what a deal is worth to them will not prioritise it
 * correctly, so this exists to answer one question honestly: what has this
 * deal actually paid me, and what might it still?
 *
 * The distinction that matters is *earned* versus *expected*:
 *
 *   earned   — real rows in the commission ledger. Money that exists.
 *   expected — a forecast off the contract value. Money that does not exist
 *              and may never; commission accrues only when a payment clears.
 *
 * They are returned as separate fields and must stay separate in the UI. A
 * single blended number would read as "what I am owed", which is the one thing
 * it is not.
 */

export type DealStatus =
  | "draft"
  | "sent"
  | "signed"
  | "delivering"
  | "complete"
  | "lost"
  | "refunded";

export interface PipelineDeal {
  id: string;
  name: string;
  account_id: string;
  account_name: string | null;
  deal_type: string;
  commission_model: "one_time" | "recurring";
  contract_value_cents: number;
  mrr_cents: number;
  status: DealStatus;
  commission_rate_bps: number | null;
  recurring_cap_months: number | null;
  recurring_months_accrued: number;
  signed_at: string | null;
}

export interface DealCommissionView extends PipelineDeal {
  /** Sum of ledger entries for this deal. Money that exists. */
  earnedCents: number;
  /** Of that, still unpaid. */
  unpaidCents: number;
  /**
   * Forecast if the contract is delivered and paid in full. Null when the deal
   * has no rate snapshot yet, because there is no honest number to show.
   */
  expectedCents: number | null;
  /** expectedCents less what has already been earned; never negative. */
  remainingCents: number | null;
  /** Deals in a status that will never pay. */
  isDead: boolean;
}

export interface StageGroup {
  status: DealStatus;
  deals: DealCommissionView[];
  earnedCents: number;
  expectedCents: number;
}

/** Statuses that can no longer produce commission. */
const DEAD_STATUSES: ReadonlySet<DealStatus> = new Set(["lost", "refunded"]);

/** Display order: the way a deal actually moves. */
export const STAGE_ORDER: DealStatus[] = [
  "draft",
  "sent",
  "signed",
  "delivering",
  "complete",
  "lost",
  "refunded",
];

/**
 * Full-contract commission forecast for a deal.
 *
 * One-time: the rate on the contract value.
 * Recurring: the rate on one month, times the cap. An uncapped retainer has no
 * finite total, so this reports a single month and the caller labels it
 * per-month rather than inventing a lifetime figure.
 */
export function expectedCommissionCents(
  deal: Pick<
    PipelineDeal,
    | "commission_model"
    | "commission_rate_bps"
    | "contract_value_cents"
    | "mrr_cents"
    | "recurring_cap_months"
    | "status"
  >
): number | null {
  if (deal.commission_rate_bps === null) return null;
  if (DEAD_STATUSES.has(deal.status)) return 0;

  if (deal.commission_model === "one_time") {
    return applyRateBps(Math.max(deal.contract_value_cents, 0), deal.commission_rate_bps);
  }

  const perMonth = applyRateBps(Math.max(deal.mrr_cents, 0), deal.commission_rate_bps);
  // Uncapped: report one month. The UI says "/mo" rather than pretending to
  // know how long the retainer runs.
  return deal.recurring_cap_months === null
    ? perMonth
    : perMonth * deal.recurring_cap_months;
}

/** True when the forecast is a monthly figure rather than a lifetime total. */
export function isPerMonthForecast(
  deal: Pick<PipelineDeal, "commission_model" | "recurring_cap_months">
): boolean {
  return deal.commission_model === "recurring" && deal.recurring_cap_months === null;
}

export interface LedgerTotalsByDeal {
  [dealId: string]: { earnedCents: number; unpaidCents: number };
}

/** Attach ledger reality and forecast to each deal. */
export function buildDealViews(
  deals: PipelineDeal[],
  ledger: LedgerTotalsByDeal
): DealCommissionView[] {
  return deals.map((deal) => {
    const totals = ledger[deal.id] ?? { earnedCents: 0, unpaidCents: 0 };
    const expectedCents = expectedCommissionCents(deal);

    return {
      ...deal,
      earnedCents: totals.earnedCents,
      unpaidCents: totals.unpaidCents,
      expectedCents,
      remainingCents:
        expectedCents === null ? null : Math.max(expectedCents - totals.earnedCents, 0),
      isDead: DEAD_STATUSES.has(deal.status),
    };
  });
}

/** Group into stages in workflow order, omitting stages with no deals. */
export function groupByStage(views: DealCommissionView[]): StageGroup[] {
  return STAGE_ORDER.map((status) => {
    const deals = views.filter((d) => d.status === status);
    return {
      status,
      deals,
      earnedCents: deals.reduce((t, d) => t + d.earnedCents, 0),
      expectedCents: deals.reduce((t, d) => t + (d.expectedCents ?? 0), 0),
    };
  }).filter((group) => group.deals.length > 0);
}

export interface PipelineTotals {
  earnedCents: number;
  unpaidCents: number;
  /** Forecast across live deals only — dead deals contribute nothing. */
  expectedCents: number;
  liveDeals: number;
  deadDeals: number;
}

export function pipelineTotals(views: DealCommissionView[]): PipelineTotals {
  const live = views.filter((d) => !d.isDead);
  return {
    earnedCents: views.reduce((t, d) => t + d.earnedCents, 0),
    unpaidCents: views.reduce((t, d) => t + d.unpaidCents, 0),
    expectedCents: live.reduce((t, d) => t + (d.expectedCents ?? 0), 0),
    liveDeals: live.length,
    deadDeals: views.length - live.length,
  };
}
