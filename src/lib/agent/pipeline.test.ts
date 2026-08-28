import { describe, it, expect } from "vitest";
import {
  buildDealViews,
  expectedCommissionCents,
  groupByStage,
  isPerMonthForecast,
  pipelineTotals,
  STAGE_ORDER,
  type PipelineDeal,
} from "./pipeline";

function deal(overrides: Partial<PipelineDeal> = {}): PipelineDeal {
  return {
    id: "deal-1",
    name: "Rapid Build",
    account_id: "acct-1",
    account_name: "Acme HVAC",
    deal_type: "rapid_build",
    commission_model: "one_time",
    contract_value_cents: 800_000,
    mrr_cents: 0,
    status: "signed",
    commission_rate_bps: 3000,
    recurring_cap_months: null,
    recurring_months_accrued: 0,
    signed_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("expectedCommissionCents", () => {
  it("is the rate on the contract value for a one-time deal", () => {
    expect(expectedCommissionCents(deal())).toBe(240_000);
  });

  it("is the monthly figure times the cap for a capped retainer", () => {
    expect(
      expectedCommissionCents(
        deal({
          commission_model: "recurring",
          contract_value_cents: 0,
          mrr_cents: 300_000,
          recurring_cap_months: 6,
        })
      )
    ).toBe(540_000); // 6 x $900
  });

  it("reports a single month for an uncapped retainer rather than inventing a lifetime", () => {
    const uncapped = deal({
      commission_model: "recurring",
      contract_value_cents: 0,
      mrr_cents: 300_000,
      recurring_cap_months: null,
    });
    expect(expectedCommissionCents(uncapped)).toBe(90_000);
    expect(isPerMonthForecast(uncapped)).toBe(true);
  });

  it("is null when the deal has no rate snapshot — no honest number to show", () => {
    expect(expectedCommissionCents(deal({ commission_rate_bps: null }))).toBeNull();
  });

  it("is zero for a lost or refunded deal", () => {
    expect(expectedCommissionCents(deal({ status: "lost" }))).toBe(0);
    expect(expectedCommissionCents(deal({ status: "refunded" }))).toBe(0);
  });

  it("forecasts a draft deal so an agent can see what closing it is worth", () => {
    expect(expectedCommissionCents(deal({ status: "draft" }))).toBe(240_000);
  });

  it("uses the deal's snapshotted rate, whatever the agent's current rate is", () => {
    // The agent's current default is not a parameter here at all.
    expect(expectedCommissionCents(deal({ commission_rate_bps: 2000 }))).toBe(160_000);
  });

  it("never returns a fractional cent", () => {
    for (const value of [1, 7, 12_345, 999_999]) {
      for (const bps of [1, 2000, 3333, 9999]) {
        const result = expectedCommissionCents(
          deal({ contract_value_cents: value, commission_rate_bps: bps })
        );
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });
});

describe("buildDealViews", () => {
  it("keeps earned and expected strictly separate", () => {
    const [view] = buildDealViews([deal()], {
      "deal-1": { earnedCents: 120_000, unpaidCents: 120_000 },
    });

    expect(view.earnedCents).toBe(120_000); // money that exists
    expect(view.expectedCents).toBe(240_000); // forecast
    expect(view.remainingCents).toBe(120_000);
  });

  it("reports zero earned for a deal with no ledger entries", () => {
    const [view] = buildDealViews([deal({ status: "draft" })], {});
    expect(view.earnedCents).toBe(0);
    expect(view.unpaidCents).toBe(0);
    expect(view.expectedCents).toBe(240_000);
  });

  it("never shows negative remaining when earnings exceed the forecast", () => {
    // A retainer that ran longer than forecast, or an adjustment.
    const [view] = buildDealViews([deal()], {
      "deal-1": { earnedCents: 500_000, unpaidCents: 0 },
    });
    expect(view.remainingCents).toBe(0);
  });

  it("leaves remaining null when there is no rate to forecast from", () => {
    const [view] = buildDealViews([deal({ commission_rate_bps: null })], {});
    expect(view.expectedCents).toBeNull();
    expect(view.remainingCents).toBeNull();
  });

  it("still reports earnings on a refunded deal, which may be negative", () => {
    const [view] = buildDealViews([deal({ status: "refunded" })], {
      "deal-1": { earnedCents: -240_000, unpaidCents: -240_000 },
    });
    expect(view.earnedCents).toBe(-240_000);
    expect(view.expectedCents).toBe(0);
    expect(view.isDead).toBe(true);
  });
});

describe("groupByStage", () => {
  it("orders stages the way a deal actually moves", () => {
    const views = buildDealViews(
      [
        deal({ id: "a", status: "complete" }),
        deal({ id: "b", status: "draft" }),
        deal({ id: "c", status: "signed" }),
      ],
      {}
    );
    expect(groupByStage(views).map((g) => g.status)).toEqual([
      "draft",
      "signed",
      "complete",
    ]);
  });

  it("omits empty stages", () => {
    const views = buildDealViews([deal({ status: "signed" })], {});
    expect(groupByStage(views)).toHaveLength(1);
  });

  it("totals each stage separately", () => {
    const views = buildDealViews(
      [
        deal({ id: "a", status: "signed" }),
        deal({ id: "b", status: "signed", contract_value_cents: 400_000 }),
      ],
      { a: { earnedCents: 240_000, unpaidCents: 0 } }
    );
    const [group] = groupByStage(views);
    expect(group.earnedCents).toBe(240_000);
    expect(group.expectedCents).toBe(360_000); // 240,000 + 120,000
  });

  it("covers every status the schema allows", () => {
    expect(STAGE_ORDER).toEqual([
      "draft",
      "sent",
      "signed",
      "delivering",
      "complete",
      "lost",
      "refunded",
    ]);
  });
});

describe("pipelineTotals", () => {
  it("excludes dead deals from the forecast but not from earnings", () => {
    const views = buildDealViews(
      [
        deal({ id: "live", status: "signed" }),
        deal({ id: "dead", status: "lost" }),
      ],
      {
        live: { earnedCents: 100_000, unpaidCents: 40_000 },
        dead: { earnedCents: 20_000, unpaidCents: 0 },
      }
    );

    const totals = pipelineTotals(views);
    expect(totals.expectedCents).toBe(240_000); // live deal only
    expect(totals.earnedCents).toBe(120_000); // both, since both are real
    expect(totals.unpaidCents).toBe(40_000);
    expect(totals.liveDeals).toBe(1);
    expect(totals.deadDeals).toBe(1);
  });

  it("handles an empty pipeline", () => {
    expect(pipelineTotals([])).toEqual({
      earnedCents: 0,
      unpaidCents: 0,
      expectedCents: 0,
      liveDeals: 0,
      deadDeals: 0,
    });
  });
});
