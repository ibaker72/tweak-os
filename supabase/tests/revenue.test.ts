import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import {
  asUser,
  connect,
  hasTestDatabase,
  resetSchema,
  seed,
  type SeedIds,
} from "./helpers";

/**
 * The revenue schema's guarantees, exercised against a real Postgres.
 *
 * Two things are load-bearing here and neither can be checked by reading the
 * SQL: that the ledger genuinely refuses to be rewritten, and that an agent
 * cannot see or create money that is not theirs. Everything else in the
 * commission engine is built on top of those two.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

/**
 * Apply a basis-point rate to a cent amount, returning whole cents.
 *
 * Integer cents in a JS number are exact to 2^53 (~$90 trillion), so this
 * needs no bigint — but it must never produce a fractional cent, and it must
 * round half away from zero so a clawback mirrors the entry it reverses
 * instead of drifting a cent. This is the spec the Phase 3 engine has to meet.
 */
function commissionCents(basisCents: number, rateBps: number): number {
  if (!Number.isInteger(basisCents) || !Number.isInteger(rateBps)) {
    throw new Error("commissionCents takes integer cents and integer bps");
  }
  const product = basisCents * rateBps;
  if (!Number.isSafeInteger(product)) {
    throw new Error("commissionCents overflowed the safe integer range");
  }
  const q = Math.trunc(product / 10000);
  const r = product % 10000;
  if (r === 0) return q;
  return Math.abs(r) * 2 >= 10000 ? q + Math.sign(product) : q;
}


/**
 * Run a statement that is expected to be rejected and return its SQLSTATE.
 * Wrapped in its own transaction and always rolled back, so a rejection never
 * leaves the connection in a failed state or leaks rows into later tests.
 */
async function rejectionCode(
  client: Client,
  sql: string,
  params: unknown[] = []
): Promise<string | null> {
  await client.query("begin");
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  } finally {
    await client.query("rollback");
  }
}

/** Same, but returns the whole error so a test can assert on the message. */
async function rejection(
  client: Client,
  sql: string,
  params: unknown[] = []
): Promise<{ code?: string; message?: string } | null> {
  await client.query("begin");
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return err as { code?: string; message?: string };
  } finally {
    await client.query("rollback");
  }
}

describeDb("revenue core schema", () => {
  let client: Client;
  let ids: SeedIds;
  let accountId: string;
  let oneTimeDealId: string;
  let retainerDealId: string;

  beforeAll(async () => {
    client = await connect("revenue");
    await resetSchema(client);
    ids = await seed(client);

    const acct = await client.query(
      `insert into accounts (lead_id, company_name, owner_agent_id)
       values ($1, 'Acme HVAC', $2) returning id`,
      [ids.leadOfA, ids.agentAAgentId]
    );
    accountId = acct.rows[0].id;

    const deals = await client.query(
      `insert into deals
         (account_id, name, deal_type, commission_model, contract_value_cents,
          mrr_cents, status, closed_by_agent_id, signed_at, commission_rate_bps,
          recurring_cap_months)
       values
         ($1, 'Rapid Build', 'rapid_build', 'one_time', 850000, 0,
          'signed', $2, now(), 3000, null),
         ($1, 'Growth Retainer', 'growth_retainer', 'recurring', 0, 250000,
          'signed', $2, now(), 3000, 12)
       returning id, name`,
      [accountId, ids.agentAAgentId]
    );
    oneTimeDealId = deals.rows.find((d) => d.name === "Rapid Build").id;
    retainerDealId = deals.rows.find((d) => d.name === "Growth Retainer").id;
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  // -------------------------------------------------------------------------
  // Ledger immutability — the core guarantee
  // -------------------------------------------------------------------------

  describe("commission_entries is append-only", () => {
    async function newEntry(overrides: Record<string, unknown> = {}) {
      const row = {
        agent_id: ids.agentAAgentId,
        deal_id: oneTimeDealId,
        entry_type: "earned",
        amount_cents: 255000,
        rate_bps_applied: 3000,
        basis_cents: 850000,
        memo: "test entry",
        ...overrides,
      };
      const { rows } = await client.query(
        `insert into commission_entries
           (agent_id, deal_id, entry_type, amount_cents, rate_bps_applied, basis_cents, memo)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [
          row.agent_id,
          row.deal_id,
          row.entry_type,
          row.amount_cents,
          row.rate_bps_applied,
          row.basis_cents,
          row.memo,
        ]
      );
      return rows[0].id as string;
    }

    const expectRejected = (sql: string, params: unknown[]) =>
      rejection(client, sql, params);

    it("refuses DELETE even for the table owner", async () => {
      const id = await newEntry();
      const err = await expectRejected("delete from commission_entries where id = $1", [id]);
      expect(err?.code).toBe("23001");
      expect(err?.message).toMatch(/append-only/i);
    });

    it("refuses an amount edit", async () => {
      const id = await newEntry();
      const err = await expectRejected(
        "update commission_entries set amount_cents = 999999 where id = $1",
        [id]
      );
      expect(err?.code).toBe("23001");
    });

    it("refuses a memo edit", async () => {
      const id = await newEntry();
      const err = await expectRejected(
        "update commission_entries set memo = 'rewritten' where id = $1",
        [id]
      );
      expect(err?.code).toBe("23001");
    });

    it("refuses an agent_id edit — commission cannot be moved between people", async () => {
      const id = await newEntry();
      const err = await expectRejected(
        "update commission_entries set agent_id = $1 where id = $2",
        [ids.agentBAgentId, id]
      );
      expect(err?.code).toBe("23001");
    });

    it("allows the single permitted transition: attaching a payout batch", async () => {
      const id = await newEntry();
      const { rows: batch } = await client.query(
        `insert into payout_batches (agent_id, period_start, period_end, total_cents)
         values ($1, '2026-01-01', '2026-01-31', 255000) returning id`,
        [ids.agentAAgentId]
      );

      const err = await expectRejected(
        "update commission_entries set payout_batch_id = $1 where id = $2",
        [batch[0].id, id]
      );
      expect(err).toBeNull();
    });

    it("refuses re-batching an entry that is already batched", async () => {
      const id = await newEntry();
      const { rows: batches } = await client.query(
        `insert into payout_batches (agent_id, period_start, period_end)
         values ($1, '2026-02-01', '2026-02-28'), ($1, '2026-03-01', '2026-03-31')
         returning id`,
        [ids.agentAAgentId]
      );

      await client.query("update commission_entries set payout_batch_id = $1 where id = $2", [
        batches[0].id,
        id,
      ]);

      const err = await expectRejected(
        "update commission_entries set payout_batch_id = $1 where id = $2",
        [batches[1].id, id]
      );
      expect(err?.code).toBe("23001");
      expect(err?.message).toMatch(/already in payout batch/i);
    });

    it("refuses clearing payout_batch_id to pull an entry back out of a batch", async () => {
      const id = await newEntry();
      const { rows: batch } = await client.query(
        `insert into payout_batches (agent_id, period_start, period_end)
         values ($1, '2026-04-01', '2026-04-30') returning id`,
        [ids.agentAAgentId]
      );
      await client.query("update commission_entries set payout_batch_id = $1 where id = $2", [
        batch[0].id,
        id,
      ]);

      const err = await expectRejected(
        "update commission_entries set payout_batch_id = null where id = $1",
        [id]
      );
      expect(err?.code).toBe("23001");
    });

    it("refuses smuggling an amount change alongside a batch assignment", async () => {
      const id = await newEntry();
      const { rows: batch } = await client.query(
        `insert into payout_batches (agent_id, period_start, period_end)
         values ($1, '2026-05-01', '2026-05-31') returning id`,
        [ids.agentAAgentId]
      );

      const err = await expectRejected(
        "update commission_entries set payout_batch_id = $1, amount_cents = 1 where id = $2",
        [batch[0].id, id]
      );
      expect(err?.code).toBe("23001");
      expect(err?.message).toMatch(/only payout_batch_id may be set/i);
    });
  });

  // -------------------------------------------------------------------------
  // Sign discipline and money math
  // -------------------------------------------------------------------------

  describe("entry sign discipline", () => {
    it("rejects a positive clawback", async () => {
      const code = await rejectionCode(
        client,
          `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents)
           values ($1, $2, 'clawback', 5000)`,
          [ids.agentAAgentId, oneTimeDealId]
      );
      expect(code).toBe("23514"); // check_violation
    });

    it("rejects a negative earned entry", async () => {
      const code = await rejectionCode(
        client,
          `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents)
           values ($1, $2, 'earned', -5000)`,
          [ids.agentAAgentId, oneTimeDealId]
      );
      expect(code).toBe("23514");
    });

    it("allows an adjustment in either direction", async () => {
      const { rowCount } = await client.query(
        `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents)
         values ($1, $2, 'adjustment', -250), ($1, $2, 'adjustment', 250)`,
        [ids.agentAAgentId, oneTimeDealId]
      );
      expect(rowCount).toBe(2);
    });
  });

  describe("balance is derived, never stored", () => {
    it("no revenue table has a balance column", async () => {
      const { rows } = await client.query(`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and column_name in ('balance', 'balance_cents', 'current_balance_cents')
      `);
      expect(rows).toEqual([]);
    });

    it("unpaid balance is SUM(amount_cents) where payout_batch_id is null", async () => {
      await client.query("begin");
      try {
        const agent = ids.agentBAgentId;
        const { rows: batch } = await client.query(
          `insert into payout_batches (agent_id, period_start, period_end)
           values ($1, '2026-06-01', '2026-06-30') returning id`,
          [agent]
        );

        // 255000 earned, 50000 clawed back, plus 100000 already paid out.
        const { rows: entries } = await client.query(
          `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents)
           values ($1,$2,'earned',255000), ($1,$2,'clawback',-50000), ($1,$2,'earned',100000)
           returning id, amount_cents`,
          [agent, oneTimeDealId]
        );
        const paidOut = entries.find(
          (e: { amount_cents: string }) => e.amount_cents === "100000"
        );
        await client.query(
          "update commission_entries set payout_batch_id = $1 where id = $2",
          [batch[0].id, paidOut.id]
        );

        const { rows } = await client.query(
          `select coalesce(sum(amount_cents), 0)::bigint as balance
           from commission_entries
           where agent_id = $1 and payout_batch_id is null`,
          [agent]
        );
        expect(rows[0].balance).toBe("205000"); // 255000 - 50000
      } finally {
        await client.query("rollback");
      }
    });

    it("a clawback can drive a balance negative rather than being clamped", async () => {
      await client.query("begin");
      try {
        const agent = ids.agentBAgentId;
        await client.query(
          `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents)
           values ($1,$2,'earned',10000), ($1,$2,'clawback',-30000)`,
          [agent, oneTimeDealId]
        );
        const { rows } = await client.query(
          `select coalesce(sum(amount_cents), 0)::bigint as balance
           from commission_entries where agent_id = $1 and payout_batch_id is null`,
          [agent]
        );
        expect(rows[0].balance).toBe("-20000");
      } finally {
        await client.query("rollback");
      }
    });
  });

  describe("commission math on the seeded deals", () => {
    it("30% of an $8,500 build is $2,550 exactly", () => {
      expect(commissionCents(850_000, 3000)).toBe(255_000);
    });

    it("30% of a $2,500 retainer month is $750", () => {
      expect(commissionCents(250_000, 3000)).toBe(75_000);
    });

    it("a 12-month cap on that retainer totals $9,000", () => {
      expect(commissionCents(250_000, 3000) * 12).toBe(900_000);
    });

    it("never returns a fractional cent", () => {
      for (const basis of [1, 3, 7, 99, 12_345, 850_001]) {
        for (const bps of [2000, 3000, 3333, 6667]) {
          expect(Number.isInteger(commissionCents(basis, bps))).toBe(true);
        }
      }
    });

    it("rounds a half-cent away from zero rather than truncating", () => {
      expect(commissionCents(1, 5000)).toBe(1); // 0.5 -> 1
      expect(commissionCents(3, 5000)).toBe(2); // 1.5 -> 2
    });

    it("a clawback mirrors the entry it reverses, cent for cent", () => {
      const earned = commissionCents(12_345, 3333);
      const clawed = commissionCents(-12_345, 3333);
      expect(earned + clawed).toBe(0);
    });

    it("a 20% referral partner rate on the same build is $1,700", () => {
      expect(commissionCents(850_000, 2000)).toBe(170_000);
    });

    it("rejects non-integer input rather than silently producing sub-cents", () => {
      expect(() => commissionCents(100.5, 3000)).toThrow(/integer cents/);
    });
  });

  // -------------------------------------------------------------------------
  // Recurring accrual and the month cap
  // -------------------------------------------------------------------------

  describe("recurring deals and the accrual cap", () => {
    it("a capped retainer records its cap and starts at zero accrued", async () => {
      const { rows } = await client.query(
        "select recurring_cap_months, recurring_months_accrued from deals where id = $1",
        [retainerDealId]
      );
      expect(rows[0].recurring_cap_months).toBe(12);
      expect(rows[0].recurring_months_accrued).toBe(0);
    });

    it("a null cap means uncapped, not zero months", async () => {
      await client.query("begin");
      try {
        const { rows } = await client.query(
          `insert into deals (account_id, name, deal_type, commission_model, mrr_cents,
             status, closed_by_agent_id, signed_at, commission_rate_bps, recurring_cap_months)
           values ($1, 'Uncapped', 'growth_retainer', 'recurring', 100000, 'signed', $2,
                   now(), 3000, null)
           returning recurring_cap_months`,
          [accountId, ids.agentAAgentId]
        );
        expect(rows[0].recurring_cap_months).toBeNull();
      } finally {
        await client.query("rollback");
      }
    });

    it("rejects a zero or negative cap, which would silently mean 'never accrue'", async () => {
      const code = await rejectionCode(
        client,
        `insert into deals (account_id, name, deal_type, commission_model, mrr_cents,
           status, closed_by_agent_id, signed_at, commission_rate_bps, recurring_cap_months)
         values ($1, 'Bad cap', 'growth_retainer', 'recurring', 100000, 'signed', $2,
                 now(), 3000, 0)`,
        [accountId, ids.agentAAgentId]
      );
      expect(code).toBe("23514");
    });

    it("rejects recurring fields on a one-time deal", async () => {
      const code = await rejectionCode(
        client,
        `insert into deals (account_id, name, deal_type, commission_model,
           contract_value_cents, status, closed_by_agent_id, signed_at,
           commission_rate_bps, recurring_cap_months)
         values ($1, 'One-time with cap', 'rapid_build', 'one_time', 500000, 'signed', $2,
                 now(), 3000, 6)`,
        [accountId, ids.agentAAgentId]
      );
      expect(code).toBe("23514");
    });

    it("accrual stops once months_accrued reaches the cap", async () => {
      await client.query("begin");
      try {
        // Walk the retainer up to its 12-month cap.
        await client.query(
          "update deals set recurring_months_accrued = 12 where id = $1",
          [retainerDealId]
        );
        const { rows } = await client.query(
          `select (recurring_cap_months is not null
                   and recurring_months_accrued >= recurring_cap_months) as capped
           from deals where id = $1`,
          [retainerDealId]
        );
        expect(rows[0].capped).toBe(true);
      } finally {
        await client.query("rollback");
      }
    });

    it("total commission on a capped retainer is monthly x cap", async () => {
      const { rows } = await client.query(
        "select mrr_cents, commission_rate_bps, recurring_cap_months from deals where id = $1",
        [retainerDealId]
      );
      const monthly = commissionCents(
        Number(rows[0].mrr_cents),
        rows[0].commission_rate_bps
      );
      expect(monthly).toBe(75_000); // 30% of $2,500
      expect(monthly * rows[0].recurring_cap_months).toBe(900_000); // $9,000
    });

    it("rejects a negative months_accrued", async () => {
      const code = await rejectionCode(
        client,
        "update deals set recurring_months_accrued = -1 where id = $1",
        [retainerDealId]
      );
      expect(code).toBe("23514");
    });
  });

  // -------------------------------------------------------------------------
  // Rate snapshotting
  // -------------------------------------------------------------------------

  describe("rate snapshot", () => {
    it("a signed deal cannot exist without a snapshotted rate", async () => {
      const code = await rejectionCode(
        client,
          `insert into deals (account_id, name, deal_type, commission_model,
             contract_value_cents, status, closed_by_agent_id, signed_at)
           values ($1, 'No rate', 'rapid_build', 'one_time', 500000, 'signed', $2, now())`,
          [accountId, ids.agentAAgentId]
      );
      expect(code).toBe("23514");
    });

    it("changing an agent's default rate does not reprice signed deals", async () => {
      await client.query("begin");
      try {
        await client.query(
          "update agent_profiles set default_commission_rate_bps = 1000 where id = $1",
          [ids.agentAAgentId]
        );
        const { rows } = await client.query(
          "select commission_rate_bps from deals where id = $1",
          [oneTimeDealId]
        );
        expect(rows[0].commission_rate_bps).toBe(3000);
      } finally {
        await client.query("rollback");
      }
    });

    it("a draft deal may still be missing its rate", async () => {
      const { rowCount } = await client.query(
        `insert into deals (account_id, name, deal_type, commission_model, status)
         values ($1, 'Draft', 'rapid_build', 'one_time', 'draft')`,
        [accountId]
      );
      expect(rowCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // received_at vs cleared_at — the refund buffer
  // -------------------------------------------------------------------------

  describe("payments", () => {
    it("keeps received_at and cleared_at as separate columns", async () => {
      const { rows } = await client.query(`
        select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'payments'
          and column_name in ('received_at', 'cleared_at')
        order by column_name
      `);
      expect(rows).toEqual([
        { column_name: "cleared_at", is_nullable: "YES" },
        { column_name: "received_at", is_nullable: "NO" },
      ]);
    });

    it("an uncleared payment contributes nothing to the accrual basis", async () => {
      await client.query("begin");
      try {
        await client.query(
          `insert into payments (deal_id, amount_cents, received_at, cleared_at)
           values ($1, 400000, now(), null), ($1, 450000, now(), now())`,
          [oneTimeDealId]
        );
        const { rows } = await client.query(
          `select coalesce(sum(amount_cents - refunded_amount_cents), 0)::bigint as basis
           from payments where deal_id = $1 and cleared_at is not null`,
          [oneTimeDealId]
        );
        expect(rows[0].basis).toBe("450000");
      } finally {
        await client.query("rollback");
      }
    });

    it("rejects clearing a payment before it was received", async () => {
      const code = await rejectionCode(
        client,
          `insert into payments (deal_id, amount_cents, received_at, cleared_at)
           values ($1, 1000, '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
          [oneTimeDealId]
      );
      expect(code).toBe("23514");
    });

    it("rejects a refund larger than the payment", async () => {
      const code = await rejectionCode(
        client,
          `insert into payments (deal_id, amount_cents, refunded_at, refunded_amount_cents)
           values ($1, 1000, now(), 5000)`,
          [oneTimeDealId]
      );
      expect(code).toBe("23514");
    });

    it("rejects a refund amount with no refund date", async () => {
      const code = await rejectionCode(
        client,
          `insert into payments (deal_id, amount_cents, refunded_amount_cents)
           values ($1, 5000, 1000)`,
          [oneTimeDealId]
      );
      expect(code).toBe("23514");
    });
  });

  // -------------------------------------------------------------------------
  // Attribution
  // -------------------------------------------------------------------------

  describe("attributions", () => {
    it("defaults expires_at to first touch plus 90 days", async () => {
      await client.query("begin");
      try {
        const { rows } = await client.query(
          `insert into attributions (agent_id, lead_id, source, first_touch_at)
           values ($1, $2, 'referral_link', '2026-01-01T00:00:00Z')
           returning expires_at`,
          [ids.agentAAgentId, ids.leadOfA]
        );
        expect(new Date(rows[0].expires_at).toISOString()).toBe("2026-04-01T00:00:00.000Z");
      } finally {
        await client.query("rollback");
      }
    });

    it("honours an explicitly set expiry", async () => {
      await client.query("begin");
      try {
        const { rows } = await client.query(
          `insert into attributions (agent_id, lead_id, source, first_touch_at, expires_at)
           values ($1, $2, 'manual_intro', '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z')
           returning expires_at`,
          [ids.agentAAgentId, ids.leadOfA]
        );
        expect(new Date(rows[0].expires_at).toISOString()).toBe("2026-12-31T00:00:00.000Z");
      } finally {
        await client.query("rollback");
      }
    });

    it("a manual intro is a row like any other source", async () => {
      await client.query("begin");
      try {
        const { rowCount } = await client.query(
          `insert into attributions (agent_id, lead_id, source)
           values ($1, $2, 'manual_intro')`,
          [ids.agentBAgentId, ids.leadOfA]
        );
        expect(rowCount).toBe(1);
      } finally {
        await client.query("rollback");
      }
    });

    it("rejects an override with no written reason", async () => {
      const code = await rejectionCode(
        client,
          `insert into attributions (agent_id, lead_id, source, is_override, override_by)
           values ($1, $2, 'manual_intro', true, $3)`,
          [ids.agentAAgentId, ids.leadOfA, ids.adminAgentId]
      );
      expect(code).toBe("23514");
    });

    it("rejects an override reason that is only whitespace", async () => {
      const code = await rejectionCode(
        client,
          `insert into attributions (agent_id, lead_id, source, is_override, override_reason, override_by)
           values ($1, $2, 'manual_intro', true, '   ', $3)`,
          [ids.agentAAgentId, ids.leadOfA, ids.adminAgentId]
      );
      expect(code).toBe("23514");
    });

    it("earliest non-expired first_touch_at wins the tie-break", async () => {
      await client.query("begin");
      try {
        await client.query(
          `insert into attributions (agent_id, lead_id, source, first_touch_at, expires_at) values
             ($1, $3, 'referral_link', now() - interval '200 days', now() - interval '110 days'),
             ($2, $3, 'manual_intro',  now() - interval '30 days',  now() + interval '60 days'),
             ($1, $3, 'self_sourced',  now() - interval '10 days',  now() + interval '80 days')`,
          [ids.agentAAgentId, ids.agentBAgentId, ids.leadOfB]
        );

        const { rows } = await client.query(
          `select agent_id from attributions
           where lead_id = $1 and expires_at > now() and not is_override
           order by first_touch_at asc limit 1`,
          [ids.leadOfB]
        );
        // Agent A's touch is older but expired, so agent B wins.
        expect(rows[0].agent_id).toBe(ids.agentBAgentId);
      } finally {
        await client.query("rollback");
      }
    });
  });

  // -------------------------------------------------------------------------
  // RLS on the revenue tables
  // -------------------------------------------------------------------------

  describe("RLS", () => {
    beforeAll(async () => {
      await client.query(
        `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents, memo)
         values ($1, $2, 'earned', 255000, 'A earned'),
                ($3, $2, 'earned', 111000, 'B earned')`,
        [ids.agentAAgentId, oneTimeDealId, ids.agentBAgentId]
      );
      await client.query(
        `insert into payout_batches (agent_id, period_start, period_end, total_cents)
         values ($1, '2026-07-01', '2026-07-31', 255000),
                ($2, '2026-07-01', '2026-07-31', 111000)`,
        [ids.agentAAgentId, ids.agentBAgentId]
      );
    });

    it("an agent sees only their own commission entries", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ agent_id: string }>("select agent_id from commission_entries")
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.agent_id === ids.agentAAgentId)).toBe(true);
    });

    it("an agent cannot read a teammate's commission entries", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from commission_entries where agent_id = $1", [
          ids.agentBAgentId,
        ])
      );
      expect(rows).toHaveLength(0);
    });

    it("an agent cannot write themselves a commission entry", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents)
           values ($1, $2, 'bonus', 100000)`,
          [ids.agentAAgentId, oneTimeDealId]
        )
      );
      expect(code).toBe("42501");
    });

    it("an agent cannot delete a commission entry", async () => {
      const deleted = await asUser(client, ids.agentAUserId, (q) =>
        q.count("delete from commission_entries where agent_id = $1", [
          ids.agentAAgentId,
        ])
      );
      expect(deleted).toBe(0);
    });

    it("an agent sees only their own payout batches", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ agent_id: string }>("select agent_id from payout_batches")
      );
      expect(rows.every((r) => r.agent_id === ids.agentAAgentId)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });

    it("an agent cannot create a payout batch for themselves", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into payout_batches (agent_id, period_start, period_end, total_cents)
           values ($1, '2026-08-01', '2026-08-31', 999999)`,
          [ids.agentAAgentId]
        )
      );
      expect(code).toBe("42501");
    });

    it("an agent reads deals they closed", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from deals where closed_by_agent_id = $1", [
          ids.agentAAgentId,
        ])
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("an agent cannot read deals they did not close", async () => {
      await client.query(
        `insert into deals (account_id, name, deal_type, commission_model,
           contract_value_cents, status, closed_by_agent_id, signed_at, commission_rate_bps)
         values ($1, 'B deal', 'rapid_build', 'one_time', 100000, 'signed', $2, now(), 3000)`,
        [accountId, ids.agentBAgentId]
      );

      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ name: string }>("select name from deals")
      );
      expect(rows.some((r) => r.name === "B deal")).toBe(false);
    });

    it("an agent cannot edit a deal's commission rate", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update deals set commission_rate_bps = 9000 where id = $1", [
          oneTimeDealId,
        ])
      );
      expect(updated).toBe(0);
    });

    it("an agent cannot record a payment", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into payments (deal_id, amount_cents) values ($1, 500000)",
          [oneTimeDealId]
        )
      );
      expect(code).toBe("42501");
    });

    it("an agent cannot write an attribution to claim a lead", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into attributions (agent_id, lead_id, source)
           values ($1, $2, 'self_sourced')`,
          [ids.agentAAgentId, ids.leadOfB]
        )
      );
      expect(code).toBe("42501");
    });

    it("an admin sees every agent's entries", async () => {
      const rows = await asUser(client, ids.adminUserId, (q) =>
        q.rows("select id from commission_entries")
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("agent_profiles commission fields", () => {
    it("seeds every existing agent at 3000 bps", async () => {
      const { rows } = await client.query(
        "select count(*)::int as n from agent_profiles where default_commission_rate_bps <> 3000"
      );
      expect(rows[0].n).toBe(0);
    });

    it("defaults partner_type to internal_agent", async () => {
      const { rows } = await client.query(
        "select count(*)::int as n from agent_profiles where partner_type <> 'internal_agent'"
      );
      expect(rows[0].n).toBe(0);
    });

    it("accepts a referral partner on the same table at a different rate", async () => {
      await client.query("begin");
      try {
        const { rows: u } = await client.query(
          "insert into auth.users (email) values ('partner@example.com') returning id"
        );
        const { rows } = await client.query(
          `insert into agent_profiles
             (user_id, display_name, email, role, partner_type, default_commission_rate_bps,
              payout_method, payout_handle)
           values ($1, 'Referral Partner', 'partner@example.com', 'agent',
                   'referral_partner', 2000, 'paypal', 'partner@example.com')
           returning partner_type, default_commission_rate_bps`,
          [u[0].id]
        );
        expect(rows[0].partner_type).toBe("referral_partner");
        expect(rows[0].default_commission_rate_bps).toBe(2000);
      } finally {
        await client.query("rollback");
      }
    });

    it("rejects a rate above 100%", async () => {
      const code = await rejectionCode(
        client,
          "update agent_profiles set default_commission_rate_bps = 10001 where id = $1",
          [ids.agentAAgentId]
      );
      expect(code).toBe("23514");
    });
  });

  describe("schema-wide guarantees still hold", () => {
    it("every table has RLS and at least one policy", async () => {
      const { rows } = await client.query(`
        select c.relname,
               c.relrowsecurity,
               (select count(*) from pg_policies p
                 where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      `);
      const bad = rows.filter(
        (r: { relrowsecurity: boolean; policies: string }) =>
          !r.relrowsecurity || Number(r.policies) === 0
      );
      expect(bad).toEqual([]);
    });

    it("no policy evaluates to a bare true", async () => {
      const { rows } = await client.query(`
        select tablename, policyname from pg_policies
        where schemaname = 'public'
          and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
      `);
      expect(rows).toEqual([]);
    });

    it("all money columns are bigint and all rate columns are integer", async () => {
      const { rows } = await client.query(`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
          and (column_name like '%_cents' or column_name like '%_bps')
      `);
      const wrong = rows.filter(
        (r: { column_name: string; data_type: string }) =>
          r.column_name.endsWith("_cents")
            ? r.data_type !== "bigint"
            : r.data_type !== "integer"
      );
      expect(wrong).toEqual([]);
    });

    it("all new timestamp columns are timestamptz", async () => {
      const { rows } = await client.query(`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('accounts','deals','deal_milestones','payments',
                             'payout_batches','commission_entries','attributions')
          and data_type like 'timestamp%'
          and data_type <> 'timestamp with time zone'
      `);
      expect(rows).toEqual([]);
    });
  });
});
