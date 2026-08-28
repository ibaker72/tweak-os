import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import { connect, hasTestDatabase, resetSchema, seed, type SeedIds } from "./helpers";
import { accrueDeal, sweepClearedPayments } from "../../src/lib/commissions/accrue";
import { recordRefund } from "../../src/lib/commissions/clawback";
import { getAgentBalance, getDealBreakdown } from "../../src/lib/commissions/balances";
import { openPayoutBatch, setBatchStatus } from "../../src/lib/commissions/payouts";
import { makePgSupabaseShim } from "./pg-shim";

/**
 * The accrual engine against a real database.
 *
 * calculate.test.ts proves the arithmetic in isolation. This suite proves the
 * writers behave against the actual schema: that the append-only trigger holds
 * under a real double-run, that the unique index catches a duplicate the
 * planner would have caught anyway, that batching moves money out of the
 * balance, and that RLS still hides one agent's ledger from another.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("commission engine (integration)", () => {
  let client: Client;
  let ids: SeedIds;
  let db: ReturnType<typeof makePgSupabaseShim>;

  beforeAll(async () => {
    client = await connect("commissions");
    await resetSchema(client);
    ids = await seed(client);
    db = makePgSupabaseShim(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  let accountId: string;

  beforeEach(async () => {
    // A clean revenue slate per test; the seeded agents and leads persist.
    //
    // TRUNCATE rather than DELETE: the ledger's append-only trigger is a
    // row-level BEFORE DELETE trigger, and it refuses every DELETE — including
    // this one. TRUNCATE does not fire row triggers, which makes it the only
    // way to reset the table, and is itself a demonstration that the ledger
    // cannot be cleared through ordinary DML.
    await client.query(`
      truncate commission_entries, payout_batches, payments,
               deal_milestones, deals, accounts
      restart identity cascade
    `);

    const { rows } = await client.query(
      `insert into accounts (lead_id, company_name, owner_agent_id)
       values ($1, 'Acme HVAC', $2) returning id`,
      [ids.leadOfA, ids.agentAAgentId]
    );
    accountId = rows[0].id;
  });

  async function makeDeal(overrides: {
    model?: "one_time" | "recurring";
    rate?: number;
    contract?: number;
    mrr?: number;
    cap?: number | null;
    agent?: string;
  } = {}) {
    const model = overrides.model ?? "one_time";
    const { rows } = await client.query(
      `insert into deals (account_id, name, deal_type, commission_model,
         contract_value_cents, mrr_cents, status, closed_by_agent_id, signed_at,
         commission_rate_bps, recurring_cap_months)
       values ($1, 'Deal', $2, $3, $4, $5, 'signed', $6, now(), $7, $8)
       returning id`,
      [
        accountId,
        model === "recurring" ? "growth_retainer" : "rapid_build",
        model,
        overrides.contract ?? (model === "one_time" ? 800_000 : 0),
        overrides.mrr ?? (model === "recurring" ? 300_000 : 0),
        overrides.agent ?? ids.agentAAgentId,
        overrides.rate ?? 3000,
        overrides.cap ?? null,
      ]
    );
    return rows[0].id as string;
  }

  async function addPayment(
    dealId: string,
    opts: { amount: number; cleared?: string | null; refunded?: number; milestone?: string | null }
  ) {
    const cleared =
      opts.cleared === undefined ? new Date().toISOString() : opts.cleared;
    // The schema requires cleared_at >= received_at, so a payment dated in the
    // past has to have been received then too.
    const received = cleared ?? new Date().toISOString();

    const { rows } = await client.query(
      `insert into payments (deal_id, milestone_id, amount_cents, received_at,
         cleared_at, refunded_amount_cents, refunded_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        dealId,
        opts.milestone ?? null,
        opts.amount,
        received,
        cleared,
        opts.refunded ?? 0,
        (opts.refunded ?? 0) > 0 ? received : null,
      ]
    );
    return rows[0].id as string;
  }

  async function ledger(dealId?: string) {
    const { rows } = await client.query(
      dealId
        ? "select entry_type, amount_cents, payout_batch_id from commission_entries where deal_id = $1 order by created_at"
        : "select entry_type, amount_cents, payout_batch_id from commission_entries order by created_at",
      dealId ? [dealId] : []
    );
    return rows as { entry_type: string; amount_cents: string; payout_batch_id: string | null }[];
  }

  const total = (rows: { amount_cents: string }[]) =>
    rows.reduce((t, r) => t + Number(r.amount_cents), 0);

  // -------------------------------------------------------------------------

  describe("accrual writes what the planner plans", () => {
    it("an $8,000 build at 3000 bps writes one 240,000-cent entry", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000 });

      const result = await accrueDeal(db, dealId);
      expect(result.entriesWritten).toBe(1);
      expect(result.centsWritten).toBe(240_000);

      const rows = await ledger(dealId);
      expect(rows).toHaveLength(1);
      expect(rows[0].entry_type).toBe("earned");
      expect(Number(rows[0].amount_cents)).toBe(240_000);
    });

    it("running accrue twice on one payment writes one entry", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000 });

      const first = await accrueDeal(db, dealId);
      const second = await accrueDeal(db, dealId);

      expect(first.entriesWritten).toBe(1);
      expect(second.entriesWritten).toBe(0);
      expect(await ledger(dealId)).toHaveLength(1);
    });

    it("the database refuses a duplicate even if the planner is bypassed", async () => {
      const dealId = await makeDeal();
      const paymentId = await addPayment(dealId, { amount: 800_000 });
      await accrueDeal(db, dealId);

      // Insert straight past the engine, the way a concurrent sweep would.
      await client.query("begin");
      let code: string | null = null;
      try {
        await client.query(
          `insert into commission_entries (agent_id, deal_id, payment_id, entry_type, amount_cents)
           values ($1, $2, $3, 'earned', 240000)`,
          [ids.agentAAgentId, dealId, paymentId]
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? null;
      } finally {
        await client.query("rollback");
      }
      expect(code).toBe("23505");
    });

    it("a payment received but not cleared accrues nothing", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000, cleared: null });

      const result = await accrueDeal(db, dealId);
      expect(result.entriesWritten).toBe(0);
      expect(result.skipped[0].reason).toBe("not_cleared");
      expect(await ledger(dealId)).toHaveLength(0);
    });

    it("three uneven milestones total exactly the single-payment figure", async () => {
      const dealId = await makeDeal();
      for (const amount of [266_667, 266_667, 266_666]) {
        await addPayment(dealId, { amount, milestone: null });
      }

      await accrueDeal(db, dealId);
      expect(total(await ledger(dealId))).toBe(240_000);
    });

    it("partial payment produces partial commission", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 400_000 });
      await addPayment(dealId, { amount: 400_000, cleared: null });

      await accrueDeal(db, dealId);
      expect(total(await ledger(dealId))).toBe(120_000);
    });

    it("uses the deal's snapshotted rate after the agent's default changes", async () => {
      const dealId = await makeDeal({ rate: 3000 });
      await addPayment(dealId, { amount: 800_000 });

      await client.query(
        "update agent_profiles set default_commission_rate_bps = 2000 where id = $1",
        [ids.agentAAgentId]
      );

      await accrueDeal(db, dealId);
      const { rows } = await client.query(
        "select rate_bps_applied, amount_cents from commission_entries where deal_id = $1",
        [dealId]
      );
      expect(rows[0].rate_bps_applied).toBe(3000);
      expect(Number(rows[0].amount_cents)).toBe(240_000);

      await client.query(
        "update agent_profiles set default_commission_rate_bps = 3000 where id = $1",
        [ids.agentAAgentId]
      );
    });

    it("stamps payable_at 30 days after clearing", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000, cleared: "2026-03-01T00:00:00.000Z" });

      await accrueDeal(db, dealId);
      const { rows } = await client.query(
        "select payable_at from commission_entries where deal_id = $1",
        [dealId]
      );
      expect(new Date(rows[0].payable_at).toISOString()).toBe("2026-03-31T00:00:00.000Z");
    });
  });

  describe("recurring retainers", () => {
    async function sixMonths(dealId: string, months: number) {
      for (let i = 0; i < months; i++) {
        await addPayment(dealId, {
          amount: 300_000,
          cleared: `2026-${String(i + 1).padStart(2, "0")}-01T00:00:00.000Z`,
        });
      }
    }

    it("stops at entry 6 with a 6-month cap and writes nothing on month 7", async () => {
      const dealId = await makeDeal({ model: "recurring", cap: 6 });
      await sixMonths(dealId, 7);

      const result = await accrueDeal(db, dealId);
      expect(result.entriesWritten).toBe(6);
      expect(total(await ledger(dealId))).toBe(540_000);

      const capped = result.skipped.filter((s) => s.reason === "recurring_cap_reached");
      expect(capped).toHaveLength(1);
      expect(capped[0].detail).toMatch(/accrued 6 of 6 capped months/);
    });

    it("accrues on month 7 when the cap is null", async () => {
      const dealId = await makeDeal({ model: "recurring", cap: null });
      await sixMonths(dealId, 7);

      const result = await accrueDeal(db, dealId);
      expect(result.entriesWritten).toBe(7);
      expect(total(await ledger(dealId))).toBe(630_000);
    });

    it("keeps deals.recurring_months_accrued in step with the ledger", async () => {
      const dealId = await makeDeal({ model: "recurring", cap: 6 });
      await sixMonths(dealId, 3);
      await accrueDeal(db, dealId);

      const { rows } = await client.query(
        "select recurring_months_accrued from deals where id = $1",
        [dealId]
      );
      expect(rows[0].recurring_months_accrued).toBe(3);
    });

    it("re-running does not advance the month counter twice", async () => {
      const dealId = await makeDeal({ model: "recurring", cap: 6 });
      await sixMonths(dealId, 3);
      await accrueDeal(db, dealId);
      await accrueDeal(db, dealId);

      const { rows } = await client.query(
        "select recurring_months_accrued from deals where id = $1",
        [dealId]
      );
      expect(rows[0].recurring_months_accrued).toBe(3);
    });
  });

  describe("clawbacks", () => {
    it("a full refund returns the balance to exactly zero", async () => {
      const dealId = await makeDeal();
      const paymentId = await addPayment(dealId, { amount: 800_000 });
      await accrueDeal(db, dealId);

      const result = await recordRefund(db, {
        paymentId,
        refundedAmountCents: 800_000,
      });
      expect(result.entriesWritten).toBe(1);

      const rows = await ledger(dealId);
      expect(rows).toHaveLength(2);
      expect(rows[1].entry_type).toBe("clawback");
      expect(total(rows)).toBe(0);
    });

    it("a partial refund claws back proportionally", async () => {
      const dealId = await makeDeal();
      const paymentId = await addPayment(dealId, { amount: 800_000 });
      await accrueDeal(db, dealId);

      await recordRefund(db, { paymentId, refundedAmountCents: 200_000 });
      expect(total(await ledger(dealId))).toBe(180_000); // 75% of 240,000
    });

    it("never edits or deletes the original entry", async () => {
      const dealId = await makeDeal();
      const paymentId = await addPayment(dealId, { amount: 800_000 });
      await accrueDeal(db, dealId);

      const before = await client.query(
        "select id, amount_cents from commission_entries where deal_id = $1",
        [dealId]
      );
      await recordRefund(db, { paymentId, refundedAmountCents: 800_000 });
      const after = await client.query(
        "select id, amount_cents from commission_entries where id = $1",
        [before.rows[0].id]
      );

      expect(after.rows).toHaveLength(1);
      expect(after.rows[0].amount_cents).toBe(before.rows[0].amount_cents);
    });

    it("a refund larger than the payment is refused", async () => {
      const dealId = await makeDeal();
      const paymentId = await addPayment(dealId, { amount: 800_000 });
      await accrueDeal(db, dealId);

      const result = await recordRefund(db, {
        paymentId,
        refundedAmountCents: 900_000,
      });
      expect(result.errors[0].message).toMatch(/exceeds the payment amount/);
      expect(total(await ledger(dealId))).toBe(240_000);
    });

    it("recording the same refund twice claws back once", async () => {
      const dealId = await makeDeal();
      const paymentId = await addPayment(dealId, { amount: 800_000 });
      await accrueDeal(db, dealId);

      await recordRefund(db, { paymentId, refundedAmountCents: 800_000 });
      const second = await recordRefund(db, { paymentId, refundedAmountCents: 800_000 });

      expect(second.entriesWritten).toBe(0);
      expect(total(await ledger(dealId))).toBe(0);
    });

    it("a clawback drives the balance negative and it carries", async () => {
      // Month 1 earned and paid out; month 2 earned then fully refunded.
      const dealId = await makeDeal({ model: "recurring", cap: null });
      await addPayment(dealId, { amount: 300_000, cleared: "2026-01-01T00:00:00.000Z" });
      const second = await addPayment(dealId, {
        amount: 300_000,
        cleared: "2026-02-01T00:00:00.000Z",
      });
      await accrueDeal(db, dealId);

      // Batch away the first month's earnings so they leave the balance.
      const batch = await openPayoutBatch(db, {
        agentId: ids.agentAAgentId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        payableAsOf: "2026-02-15T00:00:00.000Z",
      });
      expect(batch.entriesStamped).toBe(1);

      await recordRefund(db, { paymentId: second, refundedAmountCents: 300_000 });

      const balance = await getAgentBalance(db, ids.agentAAgentId);
      // Month 2 earned +90,000 and clawed back -90,000; month 1 is batched.
      expect(balance.unpaidCents).toBe(0);

      // A further clawback with nothing left to offset goes negative.
      const third = await addPayment(dealId, {
        amount: 300_000,
        cleared: "2026-03-01T00:00:00.000Z",
      });
      await accrueDeal(db, dealId);
      await client.query(
        `insert into commission_entries (agent_id, deal_id, payment_id, entry_type, amount_cents, memo)
         values ($1, $2, $3, 'clawback', -200000, 'chargeback fee')`,
        [ids.agentAAgentId, dealId, third]
      );

      const after = await getAgentBalance(db, ids.agentAAgentId);
      expect(after.unpaidCents).toBe(-110_000); // +90,000 - 200,000
    });
  });

  describe("balances", () => {
    it("reports unpaid, lifetime, and paid-out separately", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000, cleared: "2026-01-01T00:00:00.000Z" });
      await accrueDeal(db, dealId);

      const before = await getAgentBalance(db, ids.agentAAgentId);
      expect(before.unpaidCents).toBe(240_000);
      expect(before.lifetimeEarnedCents).toBe(240_000);
      expect(before.paidOutCents).toBe(0);

      await openPayoutBatch(db, {
        agentId: ids.agentAAgentId,
        periodStart: "2026-01-01",
        periodEnd: "2026-02-28",
        payableAsOf: "2026-03-01T00:00:00.000Z",
      });

      const after = await getAgentBalance(db, ids.agentAAgentId);
      expect(after.unpaidCents).toBe(0);
      expect(after.paidOutCents).toBe(240_000);
      expect(after.lifetimeEarnedCents).toBe(240_000); // unchanged by payout
    });

    it("separates payable-now from pending under Net 30", async () => {
      const dealId = await makeDeal();
      // Cleared today, so payable_at is 30 days out.
      await addPayment(dealId, { amount: 800_000 });
      await accrueDeal(db, dealId);

      const balance = await getAgentBalance(db, ids.agentAAgentId);
      expect(balance.unpaidCents).toBe(240_000);
      expect(balance.payableNowCents).toBe(0);
      expect(balance.pendingCents).toBe(240_000);
    });

    it("breaks the ledger down per deal", async () => {
      const a = await makeDeal();
      const b = await makeDeal({ contract: 400_000 });
      await addPayment(a, { amount: 800_000 });
      await addPayment(b, { amount: 400_000 });
      await accrueDeal(db, a);
      await accrueDeal(db, b);

      const breakdown = await getDealBreakdown(db, ids.agentAAgentId);
      expect(breakdown).toHaveLength(2);
      expect(breakdown[0].netCents).toBe(240_000);
      expect(breakdown[1].netCents).toBe(120_000);
    });
  });

  describe("payouts", () => {
    it("batches only entries whose Net 30 has elapsed", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 400_000, cleared: "2026-01-01T00:00:00.000Z" });
      await addPayment(dealId, { amount: 400_000, cleared: "2026-06-01T00:00:00.000Z" });
      await accrueDeal(db, dealId);

      const batch = await openPayoutBatch(db, {
        agentId: ids.agentAAgentId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        payableAsOf: "2026-02-15T00:00:00.000Z",
      });

      expect(batch.entriesStamped).toBe(1);
      expect(batch.totalCents).toBe(120_000);

      const remaining = await getAgentBalance(db, ids.agentAAgentId);
      expect(remaining.unpaidCents).toBe(120_000);
    });

    it("does not create an empty batch when nothing is due", async () => {
      const batch = await openPayoutBatch(db, {
        agentId: ids.agentBAgentId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      });
      expect(batch.batchId).toBeNull();
      expect(batch.entriesStamped).toBe(0);
    });

    it("a batched entry cannot be re-batched", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000, cleared: "2026-01-01T00:00:00.000Z" });
      await accrueDeal(db, dealId);

      const first = await openPayoutBatch(db, {
        agentId: ids.agentAAgentId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        payableAsOf: "2026-03-01T00:00:00.000Z",
      });
      expect(first.entriesStamped).toBe(1);

      const second = await openPayoutBatch(db, {
        agentId: ids.agentAAgentId,
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        payableAsOf: "2026-03-01T00:00:00.000Z",
      });
      expect(second.entriesStamped).toBe(0);
    });

    it("sweeps clawbacks into the batch alongside earnings", async () => {
      const dealId = await makeDeal();
      const paymentId = await addPayment(dealId, {
        amount: 800_000,
        cleared: "2026-01-01T00:00:00.000Z",
      });
      await accrueDeal(db, dealId);
      await recordRefund(db, { paymentId, refundedAmountCents: 200_000 });

      const batch = await openPayoutBatch(db, {
        agentId: ids.agentAAgentId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        payableAsOf: "2026-03-01T00:00:00.000Z",
      });

      expect(batch.entriesStamped).toBe(2);
      expect(batch.totalCents).toBe(180_000);
    });

    it("marks a batch paid and stamps paid_at", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000, cleared: "2026-01-01T00:00:00.000Z" });
      await accrueDeal(db, dealId);

      const batch = await openPayoutBatch(db, {
        agentId: ids.agentAAgentId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        payableAsOf: "2026-03-01T00:00:00.000Z",
      });
      const marked = await setBatchStatus(db, batch.batchId as string, "paid", {
        externalRef: "po_123",
      });
      expect(marked.ok).toBe(true);

      const { rows } = await client.query(
        "select status, paid_at, external_ref, total_cents from payout_batches where id = $1",
        [batch.batchId]
      );
      expect(rows[0].status).toBe("paid");
      expect(rows[0].paid_at).not.toBeNull();
      expect(rows[0].external_ref).toBe("po_123");
      expect(Number(rows[0].total_cents)).toBe(240_000);
    });
  });

  describe("under RLS, as a real admin rather than the table owner", () => {
    // Every other test in this file runs as the owning superuser, which
    // bypasses RLS entirely. That proves the arithmetic but not that the
    // policies actually permit the engine to do its job. These run the real
    // writers as the `authenticated` role with an admin JWT.
    async function asRole<T>(userId: string, fn: () => Promise<T>): Promise<T> {
      await client.query("begin");
      try {
        await client.query(
          `select set_config('request.jwt.claims',
             json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
          [userId]
        );
        await client.query("set local role authenticated");
        return await fn();
      } finally {
        // Rollback only, and first: `set local role` is transaction-scoped, so
        // it unwinds with the transaction. A `reset role` here would run
        // against an already-aborted transaction (an RLS refusal aborts it),
        // throw, and leave the transaction open for the next test.
        await client.query("rollback");
      }
    }

    it("an admin can accrue: the policies permit every write the engine makes", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000 });

      const result = await asRole(ids.adminUserId, () => accrueDeal(db, dealId));

      expect(result.errors).toEqual([]);
      expect(result.entriesWritten).toBe(1);
      expect(result.centsWritten).toBe(240_000);
    });

    it("an admin can batch entries — the 00017 update policy plus the trigger", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000, cleared: "2026-01-01T00:00:00.000Z" });
      await accrueDeal(db, dealId);

      const batch = await asRole(ids.adminUserId, () =>
        openPayoutBatch(db, {
          agentId: ids.agentAAgentId,
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          payableAsOf: "2026-03-01T00:00:00.000Z",
        })
      );

      expect(batch.errors).toEqual([]);
      expect(batch.entriesStamped).toBe(1);
      expect(batch.totalCents).toBe(240_000);
    });

    it("an agent cannot accrue — no insert policy on the ledger", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000 });

      const result = await asRole(ids.agentAUserId, () => accrueDeal(db, dealId));

      // The deal and payment are readable to the agent who closed it, so the
      // planner produces a plan; the insert is what RLS refuses.
      expect(result.entriesWritten).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toMatch(/row-level security/i);
    });

    it("an agent sees only their own balance", async () => {
      const dealA = await makeDeal({ agent: ids.agentAAgentId });
      const dealB = await makeDeal({ contract: 400_000, agent: ids.agentBAgentId });
      await addPayment(dealA, { amount: 800_000 });
      await addPayment(dealB, { amount: 400_000 });
      await accrueDeal(db, dealA);
      await accrueDeal(db, dealB);

      const own = await asRole(ids.agentAUserId, () =>
        getAgentBalance(db, ids.agentAAgentId)
      );
      expect(own.unpaidCents).toBe(240_000);

      // Asking for a teammate's agent_id returns nothing, not their money.
      const other = await asRole(ids.agentAUserId, () =>
        getAgentBalance(db, ids.agentBAgentId)
      );
      expect(other.unpaidCents).toBe(0);
      expect(other.entryCount).toBe(0);
    });
  });

  describe("sweep", () => {
    it("accrues across every deal with a cleared payment", async () => {
      const a = await makeDeal();
      const b = await makeDeal({ contract: 400_000, agent: ids.agentBAgentId });
      await addPayment(a, { amount: 800_000 });
      await addPayment(b, { amount: 400_000 });

      const result = await sweepClearedPayments(db, {});
      expect(result.dealsExamined).toBe(2);
      expect(result.entriesWritten).toBe(2);
      expect(result.centsWritten).toBe(360_000);
    });

    it("is idempotent across repeated sweeps", async () => {
      const dealId = await makeDeal();
      await addPayment(dealId, { amount: 800_000 });

      await sweepClearedPayments(db, {});
      const second = await sweepClearedPayments(db, {});

      expect(second.entriesWritten).toBe(0);
      expect(total(await ledger())).toBe(240_000);
    });

    it("skips deals with no agent to credit and says so", async () => {
      const { rows } = await client.query(
        `insert into deals (account_id, name, deal_type, commission_model,
           contract_value_cents, status, signed_at, commission_rate_bps)
         values ($1, 'Orphan', 'rapid_build', 'one_time', 500000, 'signed', now(), 3000)
         returning id`,
        [accountId]
      );
      await addPayment(rows[0].id, { amount: 500_000 });

      const result = await sweepClearedPayments(db, {});
      expect(result.entriesWritten).toBe(0);
      expect(result.skipped.some((s) => s.reason === "no_agent")).toBe(true);
    });
  });
});
