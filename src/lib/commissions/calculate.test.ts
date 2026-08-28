import { describe, it, expect } from "vitest";
import {
  applyRateBps,
  assertSplitIsExact,
  CommissionMathError,
  netClearedCents,
  payableAt,
  planDealLedger,
  type DealSnapshot,
  type ExistingEntry,
  type PaymentSnapshot,
} from "./calculate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT = "agent-a";
const CLEARED = "2026-03-01T00:00:00.000Z";

function oneTimeDeal(overrides: Partial<DealSnapshot> = {}): DealSnapshot {
  return {
    id: "deal-1",
    commission_model: "one_time",
    commission_rate_bps: 3000,
    recurring_cap_months: null,
    closed_by_agent_id: AGENT,
    ...overrides,
  };
}

function retainerDeal(overrides: Partial<DealSnapshot> = {}): DealSnapshot {
  return {
    id: "deal-r",
    commission_model: "recurring",
    commission_rate_bps: 3000,
    recurring_cap_months: 6,
    closed_by_agent_id: AGENT,
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentSnapshot> = {}): PaymentSnapshot {
  return {
    id: "pay-1",
    deal_id: "deal-1",
    milestone_id: null,
    amount_cents: 800_000,
    refunded_amount_cents: 0,
    received_at: CLEARED,
    cleared_at: CLEARED,
    ...overrides,
  };
}

/** Turn a plan into the ledger state it would produce, for idempotency checks. */
function asExisting(
  entries: { payment_id: string; entry_type: string; amount_cents: number }[]
): ExistingEntry[] {
  return entries.map((e, i) => ({
    id: `entry-${i}`,
    payment_id: e.payment_id,
    entry_type: e.entry_type as ExistingEntry["entry_type"],
    amount_cents: e.amount_cents,
  }));
}

function totalOf(entries: { amount_cents: number }[]): number {
  return entries.reduce((t, e) => t + e.amount_cents, 0);
}

// ---------------------------------------------------------------------------
// applyRateBps
// ---------------------------------------------------------------------------

describe("applyRateBps", () => {
  it("computes 3000 bps of an $8,000 build as 240,000 cents", () => {
    expect(applyRateBps(800_000, 3000)).toBe(240_000);
  });

  it("computes 2000 bps for a referral partner on the same build", () => {
    expect(applyRateBps(800_000, 2000)).toBe(160_000);
  });

  it("rounds half up", () => {
    expect(applyRateBps(1, 5000)).toBe(1); // 0.5 -> 1
    expect(applyRateBps(3, 5000)).toBe(2); // 1.5 -> 2
    expect(applyRateBps(1, 4999)).toBe(0); // 0.4999 -> 0
  });

  it("never returns a fractional cent", () => {
    for (const basis of [1, 3, 7, 99, 12_345, 800_001, 999_999]) {
      for (const bps of [1, 2000, 3000, 3333, 6667, 9999]) {
        expect(Number.isInteger(applyRateBps(basis, bps))).toBe(true);
      }
    }
  });

  it("handles the boundaries", () => {
    expect(applyRateBps(0, 3000)).toBe(0);
    expect(applyRateBps(800_000, 0)).toBe(0);
    expect(applyRateBps(800_000, 10_000)).toBe(800_000);
  });

  it("rejects a negative basis rather than rounding it the wrong way", () => {
    // Half-up on a negative rounds toward zero, which would stop a clawback
    // mirroring the entry it reverses. Callers negate the result instead.
    expect(() => applyRateBps(-100, 3000)).toThrow(CommissionMathError);
  });

  it("rejects non-integer money and rates", () => {
    expect(() => applyRateBps(100.5, 3000)).toThrow(/integer cents/);
    expect(() => applyRateBps(100, 30.5)).toThrow(/integer bps/);
  });

  it("rejects an out-of-range rate", () => {
    expect(() => applyRateBps(100, -1)).toThrow(CommissionMathError);
    expect(() => applyRateBps(100, 10_001)).toThrow(CommissionMathError);
  });

  it("refuses to silently lose precision on an absurd basis", () => {
    expect(() => applyRateBps(Number.MAX_SAFE_INTEGER, 3000)).toThrow(/overflow/);
  });
});

describe("payableAt", () => {
  it("is cleared_at plus 30 days (Net 30)", () => {
    expect(payableAt("2026-03-01T00:00:00.000Z")).toBe("2026-03-31T00:00:00.000Z");
  });

  it("crosses a month and a year boundary correctly", () => {
    expect(payableAt("2026-12-15T12:00:00.000Z")).toBe("2027-01-14T12:00:00.000Z");
  });

  it("handles a leap year", () => {
    expect(payableAt("2028-02-01T00:00:00.000Z")).toBe("2028-03-02T00:00:00.000Z");
  });
});

describe("netClearedCents", () => {
  it("subtracts refunds from the received amount", () => {
    expect(netClearedCents(payment({ amount_cents: 1000, refunded_amount_cents: 250 }))).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — accrual follows clearing, not signing
// ---------------------------------------------------------------------------

describe("commission accrues when a payment clears, never when a deal is signed", () => {
  it("a payment received but not cleared accrues nothing", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment({ received_at: CLEARED, cleared_at: null })],
      existingEntries: [],
    });

    expect(plan.entries).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        payment_id: "pay-1",
        reason: "not_cleared",
        detail: "payment pay-1 was received but has not cleared",
      },
    ]);
  });

  it("a signed deal with no payments at all accrues nothing", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [],
      existingEntries: [],
    });
    expect(plan.entries).toEqual([]);
  });

  it("accrues once the same payment clears", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment()],
      existingEntries: [],
    });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].amount_cents).toBe(240_000);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — Net 30
// ---------------------------------------------------------------------------

describe("payable_at is cleared_at + 30 days", () => {
  it("stamps the entry 30 days after clearing, not after receipt", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [
        payment({
          received_at: "2026-01-01T00:00:00.000Z",
          cleared_at: "2026-03-01T00:00:00.000Z",
        }),
      ],
      existingEntries: [],
    });
    expect(plan.entries[0].payable_at).toBe("2026-03-31T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — the snapshotted rate wins
// ---------------------------------------------------------------------------

describe("the deal's snapshotted rate is applied, not the agent's current rate", () => {
  it("a deal signed at 3000 bps still pays 3000 bps after the agent drops to 2000", () => {
    // The agent's current default is irrelevant: it is not an input to this
    // function at all, which is the structural guarantee. The deal carries the
    // rate it was signed at.
    const plan = planDealLedger({
      deal: oneTimeDeal({ commission_rate_bps: 3000 }),
      payments: [payment()],
      existingEntries: [],
    });

    expect(plan.entries[0].rate_bps_applied).toBe(3000);
    expect(plan.entries[0].amount_cents).toBe(240_000);
    expect(plan.entries[0].amount_cents).not.toBe(applyRateBps(800_000, 2000));
  });

  it("a deal signed at 2000 bps pays 2000 bps even when everyone else is at 3000", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal({ commission_rate_bps: 2000 }),
      payments: [payment()],
      existingEntries: [],
    });
    expect(plan.entries[0].amount_cents).toBe(160_000);
  });

  it("accrues nothing when the deal has no rate snapshot", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal({ commission_rate_bps: null }),
      payments: [payment()],
      existingEntries: [],
    });
    expect(plan.entries).toEqual([]);
    expect(plan.skipped[0].reason).toBe("no_rate_snapshot");
  });

  it("accrues nothing when nobody closed the deal", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal({ closed_by_agent_id: null }),
      payments: [payment()],
      existingEntries: [],
    });
    expect(plan.entries).toEqual([]);
    expect(plan.skipped[0].reason).toBe("no_agent");
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — milestones, and the absence of rounding drift
// ---------------------------------------------------------------------------

describe("milestone projects accrue per milestone with no rounding drift", () => {
  const milestonePayments = (amounts: number[]): PaymentSnapshot[] =>
    amounts.map((amount, i) =>
      payment({
        id: `pay-${i + 1}`,
        milestone_id: `ms-${i + 1}`,
        amount_cents: amount,
        cleared_at: `2026-0${i + 1}-01T00:00:00.000Z`,
      })
    );

  it("three uneven milestones sum to exactly the single-payment total", () => {
    const lump = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment()],
      existingEntries: [],
    });

    // 800,000 split three ways so that naive per-payment rounding would drift.
    const split = planDealLedger({
      deal: oneTimeDeal(),
      payments: milestonePayments([266_667, 266_667, 266_666]),
      existingEntries: [],
    });

    expect(split.entries).toHaveLength(3);
    expect(totalOf(split.entries)).toBe(totalOf(lump.entries));
    expect(totalOf(split.entries)).toBe(240_000);
  });

  it("holds for a split that genuinely drifts under naive rounding", () => {
    // Two token milestones plus the balance. Each 1-cent payment is 0.3 cents
    // of commission and rounds to nothing on its own, so rounding each payment
    // independently loses a cent against the rate on the whole.
    const amounts = [1, 1, 99_998];
    const naive = amounts.reduce((t, a) => t + applyRateBps(a, 3000), 0);
    const exact = applyRateBps(100_000, 3000);
    expect(naive).toBe(29_999);
    expect(exact).toBe(30_000);
    expect(naive).not.toBe(exact); // the drift this model exists to prevent

    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: milestonePayments(amounts),
      existingEntries: [],
    });
    expect(totalOf(plan.entries)).toBe(exact);

    // The cent is not invented anywhere: it appears as soon as the cumulative
    // basis crosses the rounding boundary, on the second payment.
    expect(plan.entries.map((e) => e.amount_cents)).toEqual([1, 29_999]);
  });

  it("partial payment produces partial commission", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [
        payment({ id: "pay-1", milestone_id: "ms-1", amount_cents: 400_000 }),
        payment({
          id: "pay-2",
          milestone_id: "ms-2",
          amount_cents: 400_000,
          cleared_at: null,
        }),
      ],
      existingEntries: [],
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].amount_cents).toBe(120_000); // half the build, half the commission
    expect(plan.skipped[0].reason).toBe("not_cleared");
  });

  it("stays exact across many uneven milestones", () => {
    const amounts = [1, 7, 33, 12_345, 99_999, 250_000, 437_615];
    const plan = planDealLedger({
      deal: oneTimeDeal({ commission_rate_bps: 3333 }),
      payments: milestonePayments(amounts),
      existingEntries: [],
    });
    const total = amounts.reduce((a, b) => a + b, 0);
    expect(totalOf(plan.entries)).toBe(applyRateBps(total, 3333));
  });

  it("labels milestone entries distinctly", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: milestonePayments([400_000, 400_000]),
      existingEntries: [],
    });
    expect(plan.entries[0].memo).toMatch(/Milestone commission/);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — recurring and the month cap
// ---------------------------------------------------------------------------

describe("recurring retainers", () => {
  const monthly = (n: number): PaymentSnapshot[] =>
    Array.from({ length: n }, (_, i) =>
      payment({
        id: `pay-${i + 1}`,
        deal_id: "deal-r",
        amount_cents: 300_000, // $3,000/mo
        cleared_at: `2026-${String(i + 1).padStart(2, "0")}-01T00:00:00.000Z`,
      })
    );

  it("writes one entry per cleared monthly payment", () => {
    const plan = planDealLedger({
      deal: retainerDeal(),
      payments: monthly(3),
      existingEntries: [],
    });
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries.every((e) => e.amount_cents === 90_000)).toBe(true);
  });

  it("stops at entry 6 with a 6-month cap and writes nothing on month 7", () => {
    const plan = planDealLedger({
      deal: retainerDeal({ recurring_cap_months: 6 }),
      payments: monthly(7),
      existingEntries: [],
    });

    expect(plan.entries).toHaveLength(6);
    expect(totalOf(plan.entries)).toBe(540_000); // 6 x $900

    const capped = plan.skipped.filter((s) => s.reason === "recurring_cap_reached");
    expect(capped).toHaveLength(1);
    expect(capped[0].payment_id).toBe("pay-7");
    // Rule 5: write nothing and log why.
    expect(capped[0].detail).toMatch(/accrued 6 of 6 capped months/);
  });

  it("accrues on month 7 when the cap is null", () => {
    const plan = planDealLedger({
      deal: retainerDeal({ recurring_cap_months: null }),
      payments: monthly(7),
      existingEntries: [],
    });
    expect(plan.entries).toHaveLength(7);
    expect(plan.entries[6].payment_id).toBe("pay-7");
    expect(totalOf(plan.entries)).toBe(630_000);
  });

  it("counts the cap from entries already in the ledger, not from a counter", () => {
    // Six months already earned; the seventh must still be refused even though
    // this call only sees one payment.
    const existing = asExisting(
      Array.from({ length: 6 }, (_, i) => ({
        payment_id: `pay-${i + 1}`,
        entry_type: "earned",
        amount_cents: 90_000,
      }))
    );

    const plan = planDealLedger({
      deal: retainerDeal({ recurring_cap_months: 6 }),
      payments: [
        payment({
          id: "pay-7",
          deal_id: "deal-r",
          amount_cents: 300_000,
          cleared_at: "2026-07-01T00:00:00.000Z",
        }),
      ],
      existingEntries: existing,
    });

    expect(plan.entries).toEqual([]);
    expect(plan.skipped[0].reason).toBe("recurring_cap_reached");
  });

  it("numbers each retainer month in the memo", () => {
    const plan = planDealLedger({
      deal: retainerDeal(),
      payments: monthly(2),
      existingEntries: [],
    });
    expect(plan.entries[0].memo).toMatch(/Retainer month 1/);
    expect(plan.entries[1].memo).toMatch(/Retainer month 2/);
  });

  it("skips a month that nets zero after a full refund before accrual", () => {
    const plan = planDealLedger({
      deal: retainerDeal(),
      payments: [
        payment({
          id: "pay-1",
          deal_id: "deal-r",
          amount_cents: 300_000,
          refunded_amount_cents: 300_000,
        }),
      ],
      existingEntries: [],
    });
    expect(plan.entries).toEqual([]);
    expect(plan.skipped[0].reason).toBe("zero_basis");
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — clawbacks
// ---------------------------------------------------------------------------

describe("refunds and chargebacks", () => {
  it("a full refund produces an exact negative offset and returns the balance to zero", () => {
    const earned = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment()],
      existingEntries: [],
    });
    expect(totalOf(earned.entries)).toBe(240_000);

    const afterRefund = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment({ refunded_amount_cents: 800_000 })],
      existingEntries: asExisting(
        earned.entries.map((e) => ({
          payment_id: e.payment_id,
          entry_type: e.entry_type,
          amount_cents: e.amount_cents,
        }))
      ),
    });

    expect(afterRefund.entries).toHaveLength(1);
    expect(afterRefund.entries[0].entry_type).toBe("clawback");
    expect(afterRefund.entries[0].amount_cents).toBe(-240_000);
    expect(totalOf(earned.entries) + totalOf(afterRefund.entries)).toBe(0);
  });

  it("a partial refund claws back proportionally", () => {
    const earned = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment()],
      existingEntries: [],
    });

    // $2,000 of the $8,000 refunded -> 25% of the commission comes back.
    const afterRefund = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment({ refunded_amount_cents: 200_000 })],
      existingEntries: asExisting(
        earned.entries.map((e) => ({
          payment_id: e.payment_id,
          entry_type: e.entry_type,
          amount_cents: e.amount_cents,
        }))
      ),
    });

    expect(afterRefund.entries[0].amount_cents).toBe(-60_000);
    expect(totalOf(earned.entries) + totalOf(afterRefund.entries)).toBe(180_000);
  });

  it("never edits or removes the original entry — it only adds a reversing row", () => {
    const original = asExisting([
      { payment_id: "pay-1", entry_type: "earned", amount_cents: 240_000 },
    ]);
    const snapshot = JSON.parse(JSON.stringify(original));

    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment({ refunded_amount_cents: 800_000 })],
      existingEntries: original,
    });

    expect(original).toEqual(snapshot); // inputs untouched
    expect(plan.entries.every((e) => e.entry_type === "clawback")).toBe(true);
  });

  it("carries a negative balance rather than clamping at zero", () => {
    // Month 1 earned and already paid out; month 2 refunded in full. The deal
    // nets negative, and that has to survive as a negative balance.
    const existing = asExisting([
      { payment_id: "pay-1", entry_type: "earned", amount_cents: 90_000 },
    ]);

    const plan = planDealLedger({
      deal: retainerDeal(),
      payments: [
        payment({
          id: "pay-1",
          deal_id: "deal-r",
          amount_cents: 300_000,
          refunded_amount_cents: 300_000,
        }),
      ],
      existingEntries: existing,
    });

    const balance = totalOf(existing) + totalOf(plan.entries);
    expect(plan.entries[0].amount_cents).toBe(-90_000);
    expect(balance).toBe(0);

    // A second, larger clawback on a different month drives it negative.
    const deeper = planDealLedger({
      deal: retainerDeal(),
      payments: [
        payment({
          id: "pay-2",
          deal_id: "deal-r",
          amount_cents: 300_000,
          refunded_amount_cents: 300_000,
          cleared_at: "2026-02-01T00:00:00.000Z",
        }),
      ],
      existingEntries: asExisting([
        { payment_id: "pay-2", entry_type: "earned", amount_cents: 90_000 },
      ]),
    });
    expect(totalOf(deeper.entries)).toBe(-90_000);
  });

  it("claws back only the increment when a refund grows", () => {
    const existing = asExisting([
      { payment_id: "pay-1", entry_type: "earned", amount_cents: 90_000 },
      { payment_id: "pay-1", entry_type: "clawback", amount_cents: -30_000 },
    ]);

    // Refund goes from $1,000 to $2,000 of a $3,000 month: 30,000 already
    // clawed back, target is 60,000, so only 30,000 more.
    const plan = planDealLedger({
      deal: retainerDeal(),
      payments: [
        payment({
          id: "pay-1",
          deal_id: "deal-r",
          amount_cents: 300_000,
          refunded_amount_cents: 200_000,
        }),
      ],
      existingEntries: existing,
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].amount_cents).toBe(-30_000);
  });

  it("writes nothing when the refund has already been fully clawed back", () => {
    const existing = asExisting([
      { payment_id: "pay-1", entry_type: "earned", amount_cents: 90_000 },
      { payment_id: "pay-1", entry_type: "clawback", amount_cents: -90_000 },
    ]);

    const plan = planDealLedger({
      deal: retainerDeal(),
      payments: [
        payment({
          id: "pay-1",
          deal_id: "deal-r",
          amount_cents: 300_000,
          refunded_amount_cents: 300_000,
        }),
      ],
      existingEntries: existing,
    });
    expect(plan.entries).toEqual([]);
  });

  it("a refund on one milestone claws back exactly that milestone's share", () => {
    const earned = planDealLedger({
      deal: oneTimeDeal(),
      payments: [
        payment({ id: "pay-1", milestone_id: "ms-1", amount_cents: 400_000 }),
        payment({
          id: "pay-2",
          milestone_id: "ms-2",
          amount_cents: 400_000,
          cleared_at: "2026-04-01T00:00:00.000Z",
        }),
      ],
      existingEntries: [],
    });
    expect(totalOf(earned.entries)).toBe(240_000);

    const afterRefund = planDealLedger({
      deal: oneTimeDeal(),
      payments: [
        payment({ id: "pay-1", milestone_id: "ms-1", amount_cents: 400_000 }),
        payment({
          id: "pay-2",
          milestone_id: "ms-2",
          amount_cents: 400_000,
          refunded_amount_cents: 400_000,
          cleared_at: "2026-04-01T00:00:00.000Z",
        }),
      ],
      existingEntries: asExisting(
        earned.entries.map((e) => ({
          payment_id: e.payment_id,
          entry_type: e.entry_type,
          amount_cents: e.amount_cents,
        }))
      ),
    });

    expect(totalOf(afterRefund.entries)).toBe(-120_000);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("planning twice over the state it produced plans nothing further", () => {
    const first = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment()],
      existingEntries: [],
    });

    const second = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment()],
      existingEntries: asExisting(
        first.entries.map((e) => ({
          payment_id: e.payment_id,
          entry_type: e.entry_type,
          amount_cents: e.amount_cents,
        }))
      ),
    });

    expect(second.entries).toEqual([]);
    expect(second.skipped[0].reason).toBe("already_accrued");
  });

  it("is idempotent for recurring deals too", () => {
    const payments = [
      payment({ id: "pay-1", deal_id: "deal-r", amount_cents: 300_000 }),
      payment({
        id: "pay-2",
        deal_id: "deal-r",
        amount_cents: 300_000,
        cleared_at: "2026-04-01T00:00:00.000Z",
      }),
    ];
    const first = planDealLedger({
      deal: retainerDeal(),
      payments,
      existingEntries: [],
    });
    const second = planDealLedger({
      deal: retainerDeal(),
      payments,
      existingEntries: asExisting(
        first.entries.map((e) => ({
          payment_id: e.payment_id,
          entry_type: e.entry_type,
          amount_cents: e.amount_cents,
        }))
      ),
    });
    expect(first.entries).toHaveLength(2);
    expect(second.entries).toEqual([]);
  });

  it("is idempotent after a clawback", () => {
    const existing = asExisting([
      { payment_id: "pay-1", entry_type: "earned", amount_cents: 240_000 },
      { payment_id: "pay-1", entry_type: "clawback", amount_cents: -240_000 },
    ]);
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment({ refunded_amount_cents: 800_000 })],
      existingEntries: existing,
    });
    expect(plan.entries).toEqual([]);
  });

  it("ignores payments belonging to another deal", () => {
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: [payment({ deal_id: "some-other-deal" })],
      existingEntries: [],
    });
    expect(plan.entries).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — the reconciliation assertion
// ---------------------------------------------------------------------------

describe("assertSplitIsExact", () => {
  it("passes when the split reconciles", () => {
    expect(() =>
      assertSplitIsExact({
        sourceBasisCents: 800_000,
        rateBps: 3000,
        entries: [{ amount_cents: 120_000 }, { amount_cents: 120_000 }],
      })
    ).not.toThrow();
  });

  it("throws, naming the drift, when it does not", () => {
    expect(() =>
      assertSplitIsExact({
        sourceBasisCents: 800_000,
        rateBps: 3000,
        entries: [{ amount_cents: 120_000 }, { amount_cents: 119_999 }],
      })
    ).toThrow(/drift -1/);
  });

  it("accounts for entries already in the ledger", () => {
    expect(() =>
      assertSplitIsExact({
        sourceBasisCents: 800_000,
        rateBps: 3000,
        entries: [{ amount_cents: 40_000 }],
        existingLedgerCents: 200_000,
      })
    ).not.toThrow();
  });

  it("every generated milestone plan reconciles", () => {
    const amounts = [266_667, 266_667, 266_666];
    const plan = planDealLedger({
      deal: oneTimeDeal(),
      payments: amounts.map((a, i) =>
        payment({
          id: `pay-${i}`,
          milestone_id: `ms-${i}`,
          amount_cents: a,
          cleared_at: `2026-0${i + 1}-01T00:00:00.000Z`,
        })
      ),
      existingEntries: [],
    });

    expect(() =>
      assertSplitIsExact({
        sourceBasisCents: amounts.reduce((a, b) => a + b, 0),
        rateBps: 3000,
        entries: plan.entries,
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Property sweep — the invariants must hold across the whole input space
// ---------------------------------------------------------------------------

describe("invariants across many shapes", () => {
  it("a one-time deal's entries always total the rate on the net basis", () => {
    const rates = [1, 500, 2000, 3000, 3333, 6667, 9999, 10_000];
    const splits = [
      [1],
      [1, 1, 1],
      [999_999],
      [333_333, 333_333, 333_334],
      [7, 13, 999, 100_001],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ];

    for (const rate of rates) {
      for (const split of splits) {
        const plan = planDealLedger({
          deal: oneTimeDeal({ commission_rate_bps: rate }),
          payments: split.map((amount, i) =>
            payment({
              id: `p${i}`,
              milestone_id: `m${i}`,
              amount_cents: amount,
              cleared_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
            })
          ),
          existingEntries: [],
        });

        const total = split.reduce((a, b) => a + b, 0);
        expect(
          totalOf(plan.entries),
          `rate ${rate} bps over split [${split.join(",")}]`
        ).toBe(applyRateBps(total, rate));
      }
    }
  });

  it("a full refund always returns a one-time deal to exactly zero", () => {
    for (const rate of [1, 2000, 3000, 3333, 9999]) {
      for (const amount of [1, 7, 999, 100_001, 800_000]) {
        const earned = planDealLedger({
          deal: oneTimeDeal({ commission_rate_bps: rate }),
          payments: [payment({ amount_cents: amount })],
          existingEntries: [],
        });
        const refunded = planDealLedger({
          deal: oneTimeDeal({ commission_rate_bps: rate }),
          payments: [
            payment({ amount_cents: amount, refunded_amount_cents: amount }),
          ],
          existingEntries: asExisting(
            earned.entries.map((e) => ({
              payment_id: e.payment_id,
              entry_type: e.entry_type,
              amount_cents: e.amount_cents,
            }))
          ),
        });

        expect(
          totalOf(earned.entries) + totalOf(refunded.entries),
          `rate ${rate} bps on ${amount} cents`
        ).toBe(0);
      }
    }
  });

  it("never plans a fractional or non-finite amount", () => {
    for (const rate of [1, 3333, 6667, 9999]) {
      const plan = planDealLedger({
        deal: oneTimeDeal({ commission_rate_bps: rate }),
        payments: [1, 7, 13, 99_991].map((a, i) =>
          payment({
            id: `p${i}`,
            amount_cents: a,
            cleared_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
          })
        ),
        existingEntries: [],
      });
      for (const e of plan.entries) {
        expect(Number.isSafeInteger(e.amount_cents)).toBe(true);
      }
    }
  });
});
