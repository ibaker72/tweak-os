import { describe, it, expect } from "vitest";
import {
  agentPerformance,
  collectedCents,
  commissionRateOfCollectedBps,
  currentMrrCents,
  monthlyBuckets,
  netCents,
  revenueSummary,
  type DealRow,
  type EntryRow,
  type PaymentRow,
} from "./revenue";

function deal(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: "deal-1",
    account_id: "acct-1",
    commission_model: "one_time",
    mrr_cents: 0,
    contract_value_cents: 800_000,
    status: "signed",
    closed_by_agent_id: "agent-a",
    signed_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    deal_id: "deal-1",
    amount_cents: 800_000,
    refunded_amount_cents: 0,
    received_at: "2026-03-01T00:00:00.000Z",
    cleared_at: "2026-03-08T00:00:00.000Z",
    ...overrides,
  };
}

function entry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    agent_id: "agent-a",
    deal_id: "deal-1",
    amount_cents: 240_000,
    created_at: "2026-03-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("collected revenue", () => {
  it("counts cleared payments only", () => {
    expect(
      collectedCents([payment(), payment({ cleared_at: null, amount_cents: 500_000 })])
    ).toBe(800_000);
  });

  it("nets refunds out", () => {
    expect(netCents(payment({ refunded_amount_cents: 200_000 }))).toBe(600_000);
    expect(collectedCents([payment({ refunded_amount_cents: 200_000 })])).toBe(600_000);
  });

  it("is zero for an empty book", () => {
    expect(collectedCents([])).toBe(0);
  });
});

describe("commission as a share of collected", () => {
  it("is 3000 bps when 30% of collected went out as commission", () => {
    expect(commissionRateOfCollectedBps(240_000, 800_000)).toBe(3000);
  });

  it("is null rather than zero when nothing has been collected", () => {
    // 0% would read as "commission is free"; undefined is the honest answer.
    expect(commissionRateOfCollectedBps(0, 0)).toBeNull();
    expect(commissionRateOfCollectedBps(50_000, 0)).toBeNull();
  });

  it("can exceed 100% when clawbacks lag or a deal refunded after paying out", () => {
    expect(commissionRateOfCollectedBps(240_000, 100_000)).toBe(24_000);
  });

  it("goes negative when clawbacks exceed commission written", () => {
    expect(commissionRateOfCollectedBps(-50_000, 800_000)).toBe(-625);
  });

  it("shows the uncapped-retainer problem the metric exists to expose", () => {
    // Year 3 of a $3,000/mo retainer: still paying 30% of everything collected
    // on a client closed once.
    const collected = 300_000 * 12;
    const commission = 90_000 * 12;
    expect(commissionRateOfCollectedBps(commission, collected)).toBe(3000);

    // The same book with a 6-month cap: the rate decays as the client tenures.
    const cappedCommission = 90_000 * 0;
    expect(commissionRateOfCollectedBps(cappedCommission, collected)).toBe(0);
  });
});

describe("currentMrrCents", () => {
  it("sums live recurring deals", () => {
    expect(
      currentMrrCents([
        deal({ id: "a", commission_model: "recurring", mrr_cents: 300_000, status: "signed" }),
        deal({ id: "b", commission_model: "recurring", mrr_cents: 150_000, status: "delivering" }),
      ])
    ).toBe(450_000);
  });

  it("excludes lost, refunded and draft deals", () => {
    expect(
      currentMrrCents([
        deal({ id: "a", commission_model: "recurring", mrr_cents: 300_000, status: "lost" }),
        deal({ id: "b", commission_model: "recurring", mrr_cents: 300_000, status: "refunded" }),
        deal({ id: "c", commission_model: "recurring", mrr_cents: 300_000, status: "draft" }),
      ])
    ).toBe(0);
  });

  it("ignores one-time deals entirely", () => {
    expect(currentMrrCents([deal({ contract_value_cents: 800_000 })])).toBe(0);
  });
});

describe("monthlyBuckets", () => {
  it("buckets new business by signing and collections by clearing", () => {
    const buckets = monthlyBuckets({
      deals: [deal({ signed_at: "2026-03-15T00:00:00.000Z" })],
      payments: [payment({ cleared_at: "2026-05-02T00:00:00.000Z" })],
      entries: [entry({ created_at: "2026-05-02T00:00:00.000Z" })],
    });

    const march = buckets.find((b) => b.month === "2026-03")!;
    const may = buckets.find((b) => b.month === "2026-05")!;

    // The lag between signing and collecting is the point — they do not line up.
    expect(march.newBusinessCents).toBe(800_000);
    expect(march.collectedCents).toBe(0);
    expect(may.collectedCents).toBe(800_000);
    expect(may.commissionCents).toBe(240_000);
    expect(may.commissionRateBps).toBe(3000);
  });

  it("leaves the commission rate null in a month with no collections", () => {
    const buckets = monthlyBuckets({
      deals: [deal()],
      payments: [],
      entries: [],
    });
    expect(buckets[0].commissionRateBps).toBeNull();
  });

  it("excludes lost deals from new business", () => {
    const buckets = monthlyBuckets({
      deals: [deal({ status: "lost" })],
      payments: [],
      entries: [],
    });
    expect(buckets).toHaveLength(0);
  });

  it("counts a recurring deal's MRR as its new business figure", () => {
    const buckets = monthlyBuckets({
      deals: [
        deal({ commission_model: "recurring", mrr_cents: 300_000, contract_value_cents: 0 }),
      ],
      payments: [],
      entries: [],
    });
    expect(buckets[0].newBusinessCents).toBe(300_000);
  });

  it("returns months in chronological order", () => {
    const buckets = monthlyBuckets({
      deals: [
        deal({ id: "a", signed_at: "2026-05-01T00:00:00.000Z" }),
        deal({ id: "b", signed_at: "2026-01-01T00:00:00.000Z" }),
        deal({ id: "c", signed_at: "2026-03-01T00:00:00.000Z" }),
      ],
      payments: [],
      entries: [],
    });
    expect(buckets.map((b) => b.month)).toEqual(["2026-01", "2026-03", "2026-05"]);
  });

  it("trims to the requested window, keeping the most recent months", () => {
    const buckets = monthlyBuckets({
      deals: [
        deal({ id: "a", signed_at: "2026-01-01T00:00:00.000Z" }),
        deal({ id: "b", signed_at: "2026-02-01T00:00:00.000Z" }),
        deal({ id: "c", signed_at: "2026-03-01T00:00:00.000Z" }),
      ],
      payments: [],
      entries: [],
      months: 2,
    });
    expect(buckets.map((b) => b.month)).toEqual(["2026-02", "2026-03"]);
  });

  it("ignores deals that were never signed", () => {
    const buckets = monthlyBuckets({
      deals: [deal({ signed_at: null, status: "draft" })],
      payments: [],
      entries: [],
    });
    expect(buckets).toHaveLength(0);
  });
});

describe("agentPerformance", () => {
  it("computes a close rate from resolved deals only", () => {
    const perf = agentPerformance({
      deals: [
        deal({ id: "1", status: "signed" }),
        deal({ id: "2", status: "complete" }),
        deal({ id: "3", status: "lost" }),
        // Still in flight: counts toward neither side.
        deal({ id: "4", status: "sent" }),
        deal({ id: "5", status: "draft" }),
      ],
      payments: [],
      entries: [],
    });

    expect(perf[0].dealsWon).toBe(2);
    expect(perf[0].dealsLost).toBe(1);
    expect(perf[0].closeRateBps).toBe(6667); // 2/3
  });

  it("does not punish an agent whose pipeline has not resolved yet", () => {
    const perf = agentPerformance({
      deals: [deal({ id: "1", status: "sent" }), deal({ id: "2", status: "draft" })],
      payments: [],
      entries: [],
    });
    expect(perf[0].closeRateBps).toBeNull();
    expect(perf[0].dealsWon).toBe(0);
    expect(perf[0].dealsLost).toBe(0);
  });

  it("separates two agents", () => {
    const perf = agentPerformance({
      deals: [
        deal({ id: "1", closed_by_agent_id: "agent-a", contract_value_cents: 800_000 }),
        deal({ id: "2", closed_by_agent_id: "agent-b", contract_value_cents: 400_000 }),
      ],
      payments: [],
      entries: [
        entry({ agent_id: "agent-a", amount_cents: 240_000 }),
        entry({ agent_id: "agent-b", amount_cents: 120_000 }),
      ],
    });

    // Sorted by new business, so the bigger book leads.
    expect(perf[0].agentId).toBe("agent-a");
    expect(perf[0].commissionCents).toBe(240_000);
    expect(perf[1].agentId).toBe("agent-b");
    expect(perf[1].commissionCents).toBe(120_000);
  });

  it("reports each agent's commission against their own collected revenue", () => {
    const perf = agentPerformance({
      deals: [deal({ id: "deal-1", closed_by_agent_id: "agent-a" })],
      payments: [payment({ deal_id: "deal-1", amount_cents: 800_000 })],
      entries: [entry({ agent_id: "agent-a", amount_cents: 240_000 })],
    });
    expect(perf[0].collectedCents).toBe(800_000);
    expect(perf[0].commissionRateOfCollectedBps).toBe(3000);
  });

  it("ignores deals nobody closed", () => {
    const perf = agentPerformance({
      deals: [deal({ closed_by_agent_id: null })],
      payments: [],
      entries: [],
    });
    expect(perf).toHaveLength(0);
  });
});

describe("revenueSummary", () => {
  it("computes the forward commitment on capped retainers", () => {
    const summary = revenueSummary({
      deals: [
        deal({
          id: "r1",
          commission_model: "recurring",
          mrr_cents: 300_000,
          contract_value_cents: 0,
          status: "signed",
        }),
      ],
      payments: [],
      entries: [],
      ratesByDeal: { r1: { rateBps: 3000, capMonths: 6, accrued: 2 } },
    });

    // Four months left at $900 each.
    expect(summary.recurringCommitmentCents).toBe(360_000);
    expect(summary.uncappedRecurringDeals).toBe(0);
  });

  it("counts an uncapped retainer separately rather than summing an endless liability", () => {
    const summary = revenueSummary({
      deals: [
        deal({
          id: "r1",
          commission_model: "recurring",
          mrr_cents: 300_000,
          contract_value_cents: 0,
          status: "signed",
        }),
      ],
      payments: [],
      entries: [],
      ratesByDeal: { r1: { rateBps: 3000, capMonths: null, accrued: 4 } },
    });

    expect(summary.recurringCommitmentCents).toBe(0);
    expect(summary.uncappedRecurringDeals).toBe(1);
  });

  it("is zero once a capped retainer has run to its cap", () => {
    const summary = revenueSummary({
      deals: [
        deal({
          id: "r1",
          commission_model: "recurring",
          mrr_cents: 300_000,
          contract_value_cents: 0,
          status: "delivering",
        }),
      ],
      payments: [],
      entries: [],
      ratesByDeal: { r1: { rateBps: 3000, capMonths: 6, accrued: 6 } },
    });
    expect(summary.recurringCommitmentCents).toBe(0);
  });

  it("never returns a negative commitment when accrued overshoots the cap", () => {
    const summary = revenueSummary({
      deals: [
        deal({
          id: "r1",
          commission_model: "recurring",
          mrr_cents: 300_000,
          contract_value_cents: 0,
          status: "signed",
        }),
      ],
      payments: [],
      entries: [],
      ratesByDeal: { r1: { rateBps: 3000, capMonths: 6, accrued: 9 } },
    });
    expect(summary.recurringCommitmentCents).toBe(0);
  });

  it("rolls up the headline figures", () => {
    const summary = revenueSummary({
      deals: [deal()],
      payments: [payment()],
      entries: [entry()],
      ratesByDeal: {},
    });

    expect(summary.collectedCents).toBe(800_000);
    expect(summary.commissionCents).toBe(240_000);
    expect(summary.commissionRateBps).toBe(3000);
  });
});
